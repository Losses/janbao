import { users, invitations, notificationPreferences } from '$lib/server/db/schema';
import { hashPassword, signJwt, createSessionToken } from '$lib/server/auth';
import { getJwtSecret, getCookieSecure } from '$lib/server/constants';
import { eq, or } from 'drizzle-orm';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { AuthRegisterBody } from '$lib/types/api';

const USERNAME_REGEX = /^[a-zA-Z0-9_-]{2,30}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: RequestHandler = async (event) => {
	try {
		const { db } = event.locals;
		const body = (await event.request.json()) as AuthRegisterBody;
		const { invitationCode, username, email, password, confirmPassword, displayName } = body;

		// 1. Basic validation
		if (!invitationCode || !username || !email || !password || !confirmPassword || !displayName) {
			return json({ error: 'All fields are required.' }, { status: 400 });
		}

		if (!USERNAME_REGEX.test(username)) {
			return json(
				{ error: 'Username must be 2-30 characters, alphanumeric, underscores or hyphens only.' },
				{ status: 400 }
			);
		}

		if (!EMAIL_REGEX.test(email)) {
			return json({ error: 'Please provide a valid email address.' }, { status: 400 });
		}

		if (password.length < 5) {
			return json({ error: 'Password must be at least 5 characters long.' }, { status: 400 });
		}

		if (password !== confirmPassword) {
			return json({ error: 'Passwords do not match.' }, { status: 400 });
		}

		// 2. Validate Invitation Code dynamically
		const inviteList = await db
			.select()
			.from(invitations)
			.where(eq(invitations.code, invitationCode))
			.limit(1);

		if (inviteList.length === 0) {
			return json({ error: 'Invitation code not found.' }, { status: 400 });
		}

		const invitation = inviteList[0];

		if (invitation.usedById !== null) {
			return json({ error: 'Invitation code has already been used.' }, { status: 400 });
		}

		if (invitation.expiresAt.getTime() < Date.now()) {
			return json({ error: 'Invitation code has expired.' }, { status: 400 });
		}

		// 3. Hash password
		const passwordHash = await hashPassword(password);
		const newUserId = crypto.randomUUID();

		// 4. Database execution: uniqueness check + create user inside a single transaction
		let jwtToken: string;
		try {
			await db.transaction(async (tx) => {
				// Check for existing username or email inside the transaction
				const existingUser = await tx
					.select()
					.from(users)
					.where(or(eq(users.username, username), eq(users.email, email)))
					.limit(1);

				if (existingUser.length > 0) {
					throw new Error('USERNAME_EMAIL_EXISTS');
				}

				// Create user under the standard 'member' role
				await tx.insert(users).values({
					id: newUserId,
					username,
					email,
					passwordHash,
					displayName,
					groupSlug: 'member'
				});

				// Setup default notification preferences
				await tx.insert(notificationPreferences).values({
					userId: newUserId
				});

				// Link invitation (marks as used)
				await tx
					.update(invitations)
					.set({ usedById: newUserId })
					.where(eq(invitations.code, invitationCode));
			});

			const jwtSecret = getJwtSecret(event.platform?.env);
			const payload = createSessionToken(newUserId, username, 'member', true);
			jwtToken = await signJwt(payload, jwtSecret);
		} catch (e) {
			if (e instanceof Error && e.message === 'USERNAME_EMAIL_EXISTS') {
				return json({ error: 'Username or email already exists.' }, { status: 400 });
			}
			throw e;
		}

		// 5. Set session cookie
		event.cookies.set('session_token', jwtToken, {
			path: '/',
			httpOnly: true,
			sameSite: 'strict',
			secure: getCookieSecure(event.url),
			maxAge: 2592000 // 30 days for registration
		});

		return json({ success: true, userId: newUserId });
	} catch (e) {
		console.error('Registration error:', e);
		return json({ error: 'Internal server error during registration.' }, { status: 500 });
	}
};
