import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { jsonError } from '$lib/server/errors';
import { requireAdmin } from '$lib/server/admin';
import { BOOTSTRAP_ADMIN_ID } from '$lib/server/constants';
import {
	getTargetUserGroup,
	updateUserGroup,
	userGroupExists
} from '$lib/server/db/dao/admin-permissions';
import type { AdminUserGroupChangeBody } from '$lib/types/api';

// The bootstrap admin (id 0, seeded from ADMIN_EMAIL) is the only account that
// may promote another user into the 'admin' group. All other admins are peers:
// they can change a non-admin's group but cannot touch another admin or themselves.
function isValidTargetGroup(slug: string, isSuperAdmin: boolean): boolean {
	// 'system' and 'guest' are never assignable as a real user group. 'admin' is
	// only assignable by the bootstrap super-admin.
	if (slug === 'system' || slug === 'guest') return false;
	if (slug === 'admin') return isSuperAdmin;
	return true;
}

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const authError = requireAdmin(locals.user, locals.t);
	if (authError) return authError;

	const body: AdminUserGroupChangeBody = await request.json();
	const targetUserId = Number(body.targetUserId);
	const groupSlug = body.groupSlug?.trim().toLowerCase();

	// Note: use an explicit NaN check so id 0 (the bootstrap admin) is a valid target.
	if (targetUserId === undefined || Number.isNaN(targetUserId) || !groupSlug) {
		return jsonError(locals.t, 'permissions.fieldsRequired', 400);
	}

	const isSuperAdmin = locals.user?.id === BOOTSTRAP_ADMIN_ID;
	if (!isValidTargetGroup(groupSlug, isSuperAdmin))
		return jsonError(locals.t, 'permissions.reservedGroup', 400);
	if (!(await userGroupExists(locals.db, groupSlug)))
		return jsonError(locals.t, 'common.notFound', 404);

	const currentGroupSlug = await getTargetUserGroup(locals.db, targetUserId);
	if (!currentGroupSlug) return jsonError(locals.t, 'profile.userNotFound', 404);
	// Peers (non-super-admins) cannot change an existing admin, a system sentinel,
	// or their own account. The super-admin may promote peers to admin but still
	// cannot touch the system sentinel or itself.
	const isProtectedTarget = currentGroupSlug === 'system' || targetUserId === locals.user?.id;
	if (isProtectedTarget) {
		return jsonError(locals.t, 'permissions.adminGroupChangeForbidden', 403);
	}
	if (!isSuperAdmin && currentGroupSlug === 'admin') {
		return jsonError(locals.t, 'permissions.adminGroupChangeForbidden', 403);
	}

	await updateUserGroup(locals.db, targetUserId, groupSlug);
	return json({ success: true });
};
