import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { users, passwordRecoveries } from '$lib/server/db/schema';
import { jsonError } from '$lib/server/errors';
import { requireAdmin } from '$lib/server/admin';
import { BOOTSTRAP_ADMIN_ID } from '$lib/server/constants';
import type { RequestHandler } from './$types';
import type { AuthAdminGenerateResetBody, AuthAdminGenerateResetResponse } from '$lib/types/api';

export const POST: RequestHandler = async (event) => {
	try {
		const { db, t, user: currentUser } = event.locals;

		const authError = requireAdmin(currentUser, t);
		if (authError) return authError;

		const body = (await event.request.json()) as AuthAdminGenerateResetBody;
		const { targetUserId } = body;

		if (typeof targetUserId !== 'number' || !Number.isFinite(targetUserId)) {
			return jsonError(t, 'common.badRequest', 400);
		}

		// Verify target user exists; fetch group to enforce admin-mutual-exclusion.
		const targetUserList = await db
			.select({ email: users.email, groupSlug: users.groupSlug })
			.from(users)
			.where(eq(users.id, targetUserId))
			.limit(1);

		if (targetUserList.length === 0) {
			return jsonError(t, 'common.notFound', 404);
		}

		// Protected sentinels: only the super-admin (bootstrap admin) may reset an
		// admin's password, and NO ONE may reset the 'system' sentinel (it authors the
		// isJoined activities and is never meant to be signed in as). Otherwise any
		// admin could take over another admin / the super-admin (id 0) / the system
		// sentinel via a reset link, bypassing group-change protection.
		const isSuperAdmin = currentUser?.id === BOOTSTRAP_ADMIN_ID;
		const targetGroupSlug = targetUserList[0].groupSlug;
		if (targetGroupSlug === 'system' || (targetGroupSlug === 'admin' && !isSuperAdmin)) {
			return jsonError(t, 'permissions.adminGroupChangeForbidden', 403);
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
		const guidance = t.auth.resetLinkGuidance.replace('{email}', targetUserList[0].email);

		const response: AuthAdminGenerateResetResponse = {
			success: true,
			resetLink,
			guidance
		};

		return json(response);
	} catch (e) {
		console.error('Admin generate reset link error:', e);
		return jsonError(event.locals.t, 'common.internalError', 500);
	}
};
