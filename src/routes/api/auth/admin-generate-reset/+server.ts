import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { users, passwordRecoveries } from '$lib/server/db/schema';
import { jsonError } from '$lib/server/errors';
import type { RequestHandler } from './$types';
import type { AuthAdminGenerateResetBody, AuthAdminGenerateResetResponse } from '$lib/types/api';

export const POST: RequestHandler = async (event) => {
	try {
		const { db, t, user: currentUser } = event.locals;

		// Authorize: Only admin group users can access this endpoint
		if (!currentUser || currentUser.groupSlug !== 'admin') {
			return jsonError(t, 'common.forbidden', 403);
		}

		const body = (await event.request.json()) as AuthAdminGenerateResetBody;
		const { targetUserId } = body;

		if (targetUserId === undefined || targetUserId === null || Number.isNaN(Number(targetUserId))) {
			return jsonError(t, 'common.badRequest', 400);
		}

		// Verify target user exists
		const targetUserList = await db
			.select()
			.from(users)
			.where(eq(users.id, Number(targetUserId)))
			.limit(1);

		if (targetUserList.length === 0) {
			return jsonError(t, 'common.notFound', 404);
		}

		const token = crypto.randomUUID();
		const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

		// Insert token to database
		await db.insert(passwordRecoveries).values({
			userId: Number(targetUserId),
			token: token,
			expiresAt: expiresAt
		});

		const resetLink = `${event.url.origin}/entry/reset-password?token=${token}`;

		const response: AuthAdminGenerateResetResponse = {
			success: true,
			resetLink
		};

		return json(response);
	} catch (e) {
		console.error('Admin generate reset link error:', e);
		return jsonError(event.locals.t, 'common.internalError', 500);
	}
};
