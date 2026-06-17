import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { jsonError } from '$lib/server/errors';
import { isValidAdminSlug, requireAdmin } from '$lib/server/admin';
import {
	createUserGroup,
	deleteUserGroup,
	getUserGroupCount,
	isReservedUserGroupSlug,
	listUserGroupsWithCounts,
	updateUserGroupMeta,
	userGroupExists
} from '$lib/server/db/dao/admin-permissions';
import type { AdminUserGroupDeleteBody, AdminUserGroupWriteBody } from '$lib/types/api';

export const GET: RequestHandler = async ({ locals }) => {
	const authError = requireAdmin(locals.user, locals.t);
	if (authError) return authError;

	return json({ groups: await listUserGroupsWithCounts(locals.db) });
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const authError = requireAdmin(locals.user, locals.t);
	if (authError) return authError;

	const body: AdminUserGroupWriteBody = await request.json();
	const slug = body.slug?.trim().toLowerCase();
	const title = body.title?.trim();
	const description = body.description?.trim();

	if (!slug || !title || !description)
		return jsonError(locals.t, 'permissions.fieldsRequired', 400);
	// Reserved groups are editable (title/description) - seeding is idempotent and
	// never overwrites existing rows - but their slug must stay fixed. We match by
	// slug only and never let the client rename it.
	if (!(await userGroupExists(locals.db, slug))) return jsonError(locals.t, 'common.notFound', 404);

	await updateUserGroupMeta(locals.db, slug, title, description);
	return json({ success: true });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const authError = requireAdmin(locals.user, locals.t);
	if (authError) return authError;

	const body: AdminUserGroupWriteBody = await request.json();
	const slug = body.slug?.trim().toLowerCase();
	const title = body.title?.trim();
	const description = body.description?.trim();

	if (!slug || !title || !description)
		return jsonError(locals.t, 'permissions.fieldsRequired', 400);
	if (!isValidAdminSlug(slug)) return jsonError(locals.t, 'permissions.invalidSlug', 400);
	if (isReservedUserGroupSlug(slug)) return jsonError(locals.t, 'permissions.reservedGroup', 400);
	if (await userGroupExists(locals.db, slug))
		return jsonError(locals.t, 'permissions.groupExists', 409);

	await createUserGroup(locals.db, slug, title, description);
	return json({ success: true }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const authError = requireAdmin(locals.user, locals.t);
	if (authError) return authError;

	const body: AdminUserGroupDeleteBody = await request.json();
	const slug = body.slug?.trim().toLowerCase();

	if (!slug) return jsonError(locals.t, 'permissions.fieldsRequired', 400);
	if (isReservedUserGroupSlug(slug)) return jsonError(locals.t, 'permissions.reservedGroup', 400);
	if (!(await userGroupExists(locals.db, slug))) return jsonError(locals.t, 'common.notFound', 404);
	if ((await getUserGroupCount(locals.db, slug)) > 0) {
		return jsonError(locals.t, 'permissions.groupInUse', 400);
	}

	await deleteUserGroup(locals.db, slug);
	return json({ success: true });
};
