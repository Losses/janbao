import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { jsonError } from '$lib/server/errors';
import { requireAdmin } from '$lib/server/admin';
import {
	isPermissionEditableGroupSlug,
	upsertCategoryPermissions,
	validateCategoryPermissionTargets
} from '$lib/server/db/dao/admin-permissions';
import type { AdminCategoryPermissionsUpdateBody } from '$lib/types/api';

export const PUT: RequestHandler = async ({ request, locals }) => {
	const authError = requireAdmin(locals.user, locals.t);
	if (authError) return authError;

	const body: AdminCategoryPermissionsUpdateBody = await request.json();
	const permissions = body.permissions ?? [];
	if (permissions.length === 0) return jsonError(locals.t, 'permissions.fieldsRequired', 400);
	if (permissions.some((permission) => !isPermissionEditableGroupSlug(permission.groupSlug))) {
		return jsonError(locals.t, 'permissions.reservedGroup', 400);
	}
	if (!(await validateCategoryPermissionTargets(locals.db, permissions))) {
		return jsonError(locals.t, 'common.notFound', 404);
	}

	await upsertCategoryPermissions(locals.db, permissions);
	return json({ success: true });
};
