import { users, invitations, notificationPreferences } from '$lib/server/db/schema';
import { hashPassword, signJwt } from '$lib/server/auth';
import { eq, or } from 'drizzle-orm';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		const { db } = event.locals;
		const body = await event.request.json();
		const { invitationCode, username, email, password, confirmPassword, displayName } = body;

		// 1. Basic validation
		if (!invitationCode || !username || !email || !password || !confirmPassword || !displayName) {
			return json({ error: 'All fields are required.' }, { status: 400 });
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

		// Check if used
		if (invitation.usedById !== null) {
			return json({ error: 'Invitation code has already been used.' }, { status: 400 });
		}

		// Check if expired
		if (invitation.expiresAt.getTime() < Date.now()) {
			return json({ error: 'Invitation code has expired.' }, { status: 400 });
		}

		// 3. Check for existing username or email
		const existingUser = await db
			.select()
			.from(users)
			.where(or(eq(users.username, username), eq(users.email, email)))
			.limit(1);

		if (existingUser.length > 0) {
			return json({ error: 'Username or email already exists.' }, { status: 400 });
		}

		// 4. Hash password
		const passwordHash = await hashPassword(password);
		const newUserId = crypto.randomUUID();

		// 5. Database execution: create user, link invitation, setup notifications
		await db.transaction(async (tx) => {
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
				userId: newUserId,
				profileComment: true,
				discussionReply: true,
				privateMessage: true,
				discussionComment: true,
				participatedComment: true,
				mention: true,
				bookmarkedDiscussionComment: true
			});

			// Link invitation (marks as used)
			await tx
				.update(invitations)
				.set({ usedById: newUserId })
				.where(eq(invitations.code, invitationCode));
		});

		// 6. Generate and set JWT Session Cookie
		const jwtSecret = event.platform?.env?.JWT_SECRET || 'fallback-secret-key-for-local-dev-only';
		const token = await signJwt({ sub: newUserId, username, role: 'member' }, jwtSecret);

		// Set remember me (defaults to 30 days session for register)
		event.cookies.set('session_token', token, {
			path: '/',
			httpOnly: true,
			sameSite: 'strict',
			secure: true,
			maxAge: 2592000 // 30 days
		});

		return json({ success: true, userId: newUserId });
	} catch (e) {
		console.error('Registration error:', e);
		return json({ error: 'Internal server error during registration.' }, { status: 500 });
	}
};
