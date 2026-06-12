import { users } from '$lib/server/db/schema';
import { verifyPassword, signJwt, createSessionToken } from '$lib/server/auth';
import { getJwtSecret, getCookieSecure } from '$lib/server/constants';
import { jsonError } from '$lib/server/errors';
import { json } from '@sveltejs/kit';
import { eq, or } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import type { AuthLoginBody, SessionCookieOptions } from '$lib/types/api';

export const POST: RequestHandler = async (event) => {
	try {
		const { db, t } = event.locals;
		const body = (await event.request.json()) as AuthLoginBody;
		const { usernameOrEmail, password, rememberMe } = body;

		if (!usernameOrEmail || !password) {
			return jsonError(t, 'auth.loginFieldsRequired', 400);
		}

		// Find user by username or email
		const userList = await db
			.select()
			.from(users)
			.where(or(eq(users.username, usernameOrEmail), eq(users.email, usernameOrEmail)))
			.limit(1);

		if (userList.length === 0) {
			return jsonError(t, 'auth.invalidCredentials', 400);
		}

		const user = userList[0];

		// Verify password hash
		const isValid = await verifyPassword(password, user.passwordHash);
		if (!isValid) {
			return jsonError(t, 'auth.invalidCredentials', 400);
		}

		// Generate token with proper expiration
		const jwtSecret = getJwtSecret(event.platform?.env);
		const payload = createSessionToken(user.id, user.username, user.groupSlug, !!rememberMe);
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

		return json({ success: true, userId: user.id });
	} catch (e) {
		console.error('Login error:', e);
		return jsonError(event.locals.t, 'common.internalError', 500);
	}
};
