import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { users, passwordRecoveries } from '$lib/server/db/schema';
import { hashPassword } from '$lib/server/auth';
import { jsonError } from '$lib/server/errors';
import type { RequestHandler } from './$types';
import type { AuthResetPasswordBody } from '$lib/types/api';

export const POST: RequestHandler = async (event) => {
	try {
		const { db, t } = event.locals;
		const body = (await event.request.json()) as AuthResetPasswordBody;
		const { token, password } = body;

		if (!token || !password) {
			return jsonError(t, 'auth.fillAllFields', 400);
		}

		if (password.length < 5) {
			return jsonError(t, 'auth.passwordTooShort', 400);
		}

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

		// Update password
		const hashedPassword = await hashPassword(password);
		await db
			.update(users)
			.set({ passwordHash: hashedPassword })
			.where(eq(users.id, recovery.userId));

		// Delete recovery token
		await db.delete(passwordRecoveries).where(eq(passwordRecoveries.id, recovery.id));

		return json({ success: true });
	} catch (e) {
		console.error('Reset password error:', e);
		return jsonError(event.locals.t, 'common.internalError', 500);
	}
};
