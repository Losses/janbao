import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { jsonError } from '$lib/server/errors';
import { requireAdmin } from '$lib/server/admin';
import {
	getTargetUserGroup,
	isAssignableGroupSlug,
	updateUserGroup,
	userGroupExists
} from '$lib/server/db/dao/admin-permissions';
import type { AdminUserGroupChangeBody } from '$lib/types/api';

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const authError = requireAdmin(locals.user, locals.t);
	if (authError) return authError;

	const body: AdminUserGroupChangeBody = await request.json();
	const targetUserId = Number(body.targetUserId);
	const groupSlug = body.groupSlug?.trim().toLowerCase();

	if (!targetUserId || !groupSlug) return jsonError(locals.t, 'permissions.fieldsRequired', 400);
	if (!isAssignableGroupSlug(groupSlug))
		return jsonError(locals.t, 'permissions.reservedGroup', 400);
	if (!(await userGroupExists(locals.db, groupSlug)))
		return jsonError(locals.t, 'common.notFound', 404);

	const currentGroupSlug = await getTargetUserGroup(locals.db, targetUserId);
	if (!currentGroupSlug) return jsonError(locals.t, 'profile.userNotFound', 404);
	if (currentGroupSlug === 'admin' || targetUserId === locals.user?.id) {
		return jsonError(locals.t, 'permissions.adminGroupChangeForbidden', 403);
	}

	await updateUserGroup(locals.db, targetUserId, groupSlug);
	return json({ success: true });
};
