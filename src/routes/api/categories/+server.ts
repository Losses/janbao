import { json } from '@sveltejs/kit';
import { categories, categoryPermissions } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { resolveGroupSlug } from '$lib/server/constants';
import { resolveCategoriesI18n } from '$lib/server/i18n';

/**
 * Categories list endpoint for sidebar widget.
 * Returns categories readable by the current user's group (or guest).
 */
export const GET: RequestHandler = async ({ locals }) => {
	const db = locals.db;
	const groupSlug = resolveGroupSlug(locals.user);
	const t = locals.t;

	const allCategories = await db
		.select({
			slug: categories.slug,
			title: categories.title,
			description: categories.description
		})
		.from(categories)
		.orderBy(categories.displayOrder);

	if (allCategories.length === 0) {
		return json([]);
	}

	const perms = await db
		.select({
			categorySlug: categoryPermissions.categorySlug,
			canRead: categoryPermissions.canRead
		})
		.from(categoryPermissions)
		.where(eq(categoryPermissions.groupSlug, groupSlug));

	const permMap = new Map(perms.map((p) => [p.categorySlug, p.canRead]));

	const readableCategories = allCategories.filter((cat) => {
		const canRead = permMap.get(cat.slug);
		return canRead === undefined ? true : canRead;
	});

	return json(resolveCategoriesI18n(readableCategories, t), {
		headers: {
			'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
		}
	});
};
