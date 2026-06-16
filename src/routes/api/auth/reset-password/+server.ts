import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { users, passwordRecoveries } from '$lib/server/db/schema';
import { hashPassword } from '$lib/server/auth';
import { jsonError } from '$lib/server/errors';
import {
	enforceThrottle,
	getClientAddressSafe,
	tooManyRequests,
	RESET_IP_THROTTLE
} from '$lib/server/throttle';
import type { DbTransaction } from '$lib/server/db';
import type { RequestHandler } from './$types';
import type { AuthResetPasswordBody } from '$lib/types/api';

const TOKEN_ALREADY_USED = 'TOKEN_ALREADY_USED';

export const POST: RequestHandler = async (event) => {
	try {
		const { db, t } = event.locals;
		const body = (await event.request.json()) as AuthResetPasswordBody;
		const { token, password } = body;

		if (!token || !password) {
			return jsonError(t, 'auth.fillAllFields', 400);
		}

		if (password.length < 8) {
			return jsonError(t, 'auth.passwordTooShort', 400);
		}

		// Rate limit: per-IP fixed window (shared across isolates).
		const ip = getClientAddressSafe(event);
		const ipResult = await enforceThrottle(db, 'reset:ip', ip, RESET_IP_THROTTLE);
		if (ipResult.blocked) return tooManyRequests(t.auth.tooManyAttempts, ipResult.retryAfter);

		// Find recovery record
		const recoveryList = await db
			.select()
			.from(passwordRecoveries)
			.where(eq(passwordRecoveries.token, token))
			.limit(1);

		if (recoveryList.length === 0) {
			return jsonError(t, 'auth.invalidOrExpiredToken', 400);
		}

		const recovery = recoveryList[0];

		// Check expiration
		if (recovery.expiresAt < new Date()) {
			// Clean up expired token
			await db.delete(passwordRecoveries).where(eq(passwordRecoveries.id, recovery.id));
			return jsonError(t, 'auth.invalidOrExpiredToken', 400);
		}

		// Block the system sentinel (and any account whose user row is gone) from
		// having a password installed via reset - parity with admin-generate-reset.
		const targetList = await db
			.select({ groupSlug: users.groupSlug })
			.from(users)
			.where(eq(users.id, recovery.userId))
			.limit(1);
		if (targetList.length === 0 || targetList[0].groupSlug === 'system') {
			await db.delete(passwordRecoveries).where(eq(passwordRecoveries.id, recovery.id));
			return jsonError(t, 'auth.invalidOrExpiredToken', 400);
		}

		// Consume the token and set the new password atomically. The conditional
		// delete claims the row: only one racing request can succeed, enforcing
		// strict single-use without a separate lookup race.
		const hashedPassword = await hashPassword(password);
		try {
			await db.transaction(async (tx: DbTransaction) => {
				const claimed = await tx
					.delete(passwordRecoveries)
					.where(eq(passwordRecoveries.id, recovery.id))
					.returning({ id: passwordRecoveries.id });
				if (claimed.length === 0) {
					throw new Error(TOKEN_ALREADY_USED);
				}
				await tx
					.update(users)
					.set({ passwordHash: hashedPassword })
					.where(eq(users.id, recovery.userId));
			});
		} catch (e) {
			if (e instanceof Error && e.message === TOKEN_ALREADY_USED) {
				return jsonError(t, 'auth.invalidOrExpiredToken', 400);
			}
			throw e;
		}

		return json({ success: true });
	} catch (e) {
		console.error('Reset password error:', e);
		return jsonError(event.locals.t, 'common.internalError', 500);
	}
};
