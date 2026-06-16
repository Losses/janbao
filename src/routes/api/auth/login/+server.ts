import { users } from '$lib/server/db/schema';
import { verifyPassword, signJwt, createSessionToken, hashPassword } from '$lib/server/auth';
import { getJwtSecret, getCookieSecure } from '$lib/server/constants';
import { jsonError } from '$lib/server/errors';
import { json } from '@sveltejs/kit';
import { sql, or } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import type { AuthLoginBody, SessionCookieOptions } from '$lib/types/api';
import {
	enforceThrottle,
	getClientAddressSafe,
	tooManyRequests,
	LOGIN_IP_THROTTLE,
	LOGIN_IDENTITY_THROTTLE
} from '$lib/server/throttle';

// Precomputed PBKDF2 hash used to equalise timing on the user-not-found path so
// every login failure (unknown user, system sentinel, wrong password) costs a
// full PBKDF2 derivation and is indistinguishable by latency.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
	return (dummyHashPromise ??= hashPassword('timing-equalization-dummy-secret'));
}

export const POST: RequestHandler = async (event) => {
	try {
		const { db, t } = event.locals;
		const body = (await event.request.json()) as AuthLoginBody;
		const { usernameOrEmail, password, rememberMe } = body;

		if (!usernameOrEmail || !password) {
			return jsonError(t, 'auth.loginFieldsRequired', 400);
		}

		// Rate limit: per-IP and per-identity fixed windows (shared across isolates).
		const ip = getClientAddressSafe(event);
		const identityKey = usernameOrEmail.toLowerCase();
		const ipResult = await enforceThrottle(db, 'login:ip', ip, LOGIN_IP_THROTTLE);
		if (ipResult.blocked) return tooManyRequests(t.auth.tooManyAttempts, ipResult.retryAfter);
		const idResult = await enforceThrottle(db, 'login:id', identityKey, LOGIN_IDENTITY_THROTTLE);
		if (idResult.blocked) return tooManyRequests(t.auth.tooManyAttempts, idResult.retryAfter);

		// Case-insensitive lookup: username/email use BINARY collation, so compare
		// on the lower-cased form to let users sign in regardless of case.
		const userList = await db
			.select()
			.from(users)
			.where(
				or(
					sql`lower(${users.username}) = lower(${usernameOrEmail})`,
					sql`lower(${users.email}) = lower(${usernameOrEmail})`
				)
			)
			.limit(1);

		const user = userList[0];

		// The system sentinel must never authenticate. Unknown user and sentinel
		// both fall through to a dummy PBKDF2 verify so timing stays uniform.
		if (!user || user.groupSlug === 'system') {
			await verifyPassword(password, await getDummyHash());
			return jsonError(t, 'auth.invalidCredentials', 400);
		}

		// Verify password hash
		const isValid = await verifyPassword(password, user.passwordHash);
		if (!isValid) {
			return jsonError(t, 'auth.invalidCredentials', 400);
		}

		// Generate token with proper expiration
		const jwtSecret = getJwtSecret(event.platform?.env);
		const payload = createSessionToken(
			String(user.id),
			user.username,
			user.groupSlug,
			!!rememberMe
		);
		const token = await signJwt(payload, jwtSecret);

		// Set cookie session settings
		const cookieOptions: SessionCookieOptions = {
			path: '/',
			httpOnly: true,
			sameSite: 'strict',
			secure: getCookieSecure(event.url)
		};

		if (rememberMe) {
			cookieOptions.maxAge = 2592000; // 30 days
		}

		event.cookies.set('session_token', token, cookieOptions);

		return json({ success: true });
	} catch (e) {
		console.error('Login error:', e);
		return jsonError(event.locals.t, 'common.internalError', 500);
	}
};
