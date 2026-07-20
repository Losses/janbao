import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { jsonError } from '$lib/server/errors';
import { isValidAdminSlug, requireAdmin } from '$lib/server/admin';
import {
	categoryExists,
	createCategory,
	listAdminCategories,
	setCategoryDisabled,
	updateCategory
} from '$lib/server/db/dao/admin-permissions';
import type {
	AdminCategoryCreateBody,
	AdminCategoryDeleteBody,
	AdminCategoryItem,
	AdminCategoryUpdateBody
} from '$lib/types/api';

function normalizeNumber(value: number | undefined, fallback: number): number {
	return Number.isFinite(value) ? Number(value) : fallback;
}

export const GET: RequestHandler = async ({ locals }) => {
	const authError = requireAdmin(locals.user, locals.t);
	if (authError) return authError;

	return json({ categories: await listAdminCategories(locals.db) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const authError = requireAdmin(locals.user, locals.t);
	if (authError) return authError;

	const body: AdminCategoryCreateBody = await request.json();
	const slug = body.slug?.trim().toLowerCase();
	const title = body.title?.trim();
	const description = body.description?.trim();

	if (!slug || !title || !description)
		return jsonError(locals.t, 'permissions.fieldsRequired', 400);
	if (!isValidAdminSlug(slug)) return jsonError(locals.t, 'permissions.invalidSlug', 400);

	const category: AdminCategoryItem = {
		slug,
		title,
		description,
		priority: normalizeNumber(body.priority, 1),
		displayOrder: normalizeNumber(body.displayOrder, 1),
		themeName: body.themeName?.trim() || null,
		disabledAt: null
	};

	// Race-safe create: the slug PK is the authority. A concurrent duplicate
	// folds onto the existing row and surfaces a clean 409 here.
	const created = await createCategory(locals.db, category);
	if (!created) return jsonError(locals.t, 'permissions.categoryExists', 409);
	return json({ success: true }, { status: 201 });
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const authError = requireAdmin(locals.user, locals.t);
	if (authError) return authError;

	const body: AdminCategoryUpdateBody = await request.json();
	const slug = body.slug?.trim().toLowerCase();
	if (!slug) return jsonError(locals.t, 'permissions.fieldsRequired', 400);
	if (!(await categoryExists(locals.db, slug))) return jsonError(locals.t, 'common.notFound', 404);

	const existing = (await listAdminCategories(locals.db)).find(
		(category) => category.slug === slug
	);
	if (!existing) return jsonError(locals.t, 'common.notFound', 404);

	const category: AdminCategoryItem = {
		slug,
		title: body.title?.trim() || existing.title,
		description: body.description?.trim() || existing.description,
		priority: normalizeNumber(body.priority, existing.priority),
		displayOrder: normalizeNumber(body.displayOrder, existing.displayOrder),
		themeName: body.themeName === undefined ? existing.themeName : body.themeName?.trim() || null,
		disabledAt:
			body.disabled === undefined ? existing.disabledAt : body.disabled ? new Date() : null
	};

	await updateCategory(locals.db, category);
	return json({ success: true });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const authError = requireAdmin(locals.user, locals.t);
	if (authError) return authError;

	const body: AdminCategoryDeleteBody = await request.json();
	const slug = body.slug?.trim().toLowerCase();
	if (!slug) return jsonError(locals.t, 'permissions.fieldsRequired', 400);
	if (!(await categoryExists(locals.db, slug))) return jsonError(locals.t, 'common.notFound', 404);

	await setCategoryDisabled(locals.db, slug, true);
	return json({ success: true });
};
