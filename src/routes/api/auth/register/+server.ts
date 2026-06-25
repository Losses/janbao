import { users, invitations, notificationPreferences } from '$lib/server/db/schema';
import type { DbTransaction } from '$lib/server/db';
import { appendJoinedMember } from '$lib/server/db/joined-activity';
import { indexUser } from '$lib/server/search/fts';
import { hashPassword, signJwt, createSessionToken } from '$lib/server/auth';
import { getJwtSecret, getCookieSecure } from '$lib/server/constants';
import { jsonError } from '$lib/server/errors';
import { json } from '@sveltejs/kit';
import { eq, or, and, isNull, gte, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import type { AuthRegisterBody } from '$lib/types/api';
import {
	isValidUsername,
	EMAIL_REGEX,
	MIN_PASSWORD_LENGTH,
	MAX_DISPLAY_NAME_LENGTH,
	MAX_EMAIL_LENGTH
} from '$lib/utils/validation';

export const POST: RequestHandler = async (event) => {
	try {
		const { db, t } = event.locals;
		const body = (await event.request.json()) as AuthRegisterBody;
		const { invitationCode, username, email, password, confirmPassword, displayName } = body;

		// 1. Basic validation
		if (!invitationCode || !username || !email || !password || !confirmPassword || !displayName) {
			return jsonError(t, 'auth.allFieldsRequired', 400);
		}

		if (!isValidUsername(username)) {
			return jsonError(t, 'auth.invalidUsername', 400);
		}

		if (!EMAIL_REGEX.test(email)) {
			return jsonError(t, 'auth.invalidEmail', 400);
		}

		if (email.length > MAX_EMAIL_LENGTH) {
			return jsonError(t, 'auth.invalidEmail', 400);
		}

		if (password.length < MIN_PASSWORD_LENGTH) {
			return jsonError(t, 'auth.passwordTooShort', 400);
		}

		if (password !== confirmPassword) {
			return jsonError(t, 'auth.passwordsMismatch', 400);
		}

		if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
			return jsonError(t, 'auth.displayNameTooLong', 400);
		}

		// 2. Validate Invitation Code dynamically
		const inviteList = await db
			.select()
			.from(invitations)
			.where(eq(invitations.code, invitationCode))
			.limit(1);

		if (inviteList.length === 0) {
			return jsonError(t, 'auth.invitationNotFound', 400);
		}

		const invitation = inviteList[0];

		if (invitation.usedById !== null) {
			return jsonError(t, 'auth.invitationUsed', 400);
		}

		if (invitation.expiresAt.getTime() < Date.now()) {
			return jsonError(t, 'auth.invitationExpired', 400);
		}

		// 3. Hash password
		const passwordHash = await hashPassword(password);

		// 4. Database execution: uniqueness check + create user inside a single transaction.
		// users.id is an auto-incrementing INTEGER PK, so it is assigned by the DB and
		// read back via returning() rather than pre-generated.
		let jwtToken: string;
		let newUserId: number;
		try {
			newUserId = await db.transaction(async (tx: DbTransaction) => {
				// Check for existing username or email inside the transaction,
				// case-insensitively (columns use BINARY collation; a lower() unique
				// index backstops this against concurrent registrations).
				const existingUser = await tx
					.select()
					.from(users)
					.where(
						or(
							sql`lower(${users.username}) = lower(${username})`,
							sql`lower(${users.email}) = lower(${email})`
						)
					)
					.limit(1);

				if (existingUser.length > 0) {
					throw new Error('USERNAME_EMAIL_EXISTS');
				}

				// Create user under the standard 'member' role; id is auto-assigned.
				// Email is canonicalised to lower case so lookups stay consistent.
				const inserted = await tx
					.insert(users)
					.values({
						username,
						email: email.toLowerCase(),
						passwordHash,
						displayName,
						groupSlug: 'member'
					})
					.returning({ id: users.id });

				// Setup default notification preferences
				await tx.insert(notificationPreferences).values({
					userId: inserted[0].id
				});

				// Index the new user for the Users search scope. bio is unset at
				// signup (defaults to null in the source row), so index it empty.
				await indexUser(tx, inserted[0].id, username, displayName, '');

				// Claim the invitation code atomically: the conditional update
				// (usedById IS NULL AND still unexpired) ensures two concurrent
				// registrations cannot both consume the same code, and an invitation
				// that expires mid-request cannot be consumed either. Roll back
				// (rollback of the user insert too) if another request got there first
				// or the code has just expired.
				const consumed = await tx
					.update(invitations)
					.set({ usedById: inserted[0].id })
					.where(
						and(
							eq(invitations.code, invitationCode),
							isNull(invitations.usedById),
							gte(invitations.expiresAt, new Date())
						)
					)
					.returning({ code: invitations.code });
				if (consumed.length === 0) {
					throw new Error('INVITATION_CONSUMED');
				}

				// Append the new member into today's "who joined" activity (created
				// lazily per calendar day). Replaces the old next-day welcome-post cron.
				await appendJoinedMember(tx, inserted[0].id, new Date(), event.platform?.env);

				return inserted[0].id;
			});

			const jwtSecret = getJwtSecret(event.platform?.env);
			const payload = createSessionToken(String(newUserId), username, 'member', true);
			jwtToken = await signJwt(payload, jwtSecret);
		} catch (e) {
			if (e instanceof Error && e.message === 'USERNAME_EMAIL_EXISTS') {
				return jsonError(event.locals.t, 'auth.usernameOrEmailExists', 400);
			}
			if (e instanceof Error && e.message === 'INVITATION_CONSUMED') {
				return jsonError(event.locals.t, 'auth.invitationUsed', 400);
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
		return jsonError(event.locals.t, 'common.internalError', 500);
	}
};
