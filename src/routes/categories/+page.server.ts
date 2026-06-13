import type { PageServerLoad } from './$types';
import { categories, categoryPermissions } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { resolveGroupSlug } from '$lib/server/constants';

export const load: PageServerLoad = async ({ locals }) => {
	const db = locals.db;
	const user = locals.user;
	const groupSlug = resolveGroupSlug(user);

	// Batch query: fetch all categories and their permissions for this group in 2 queries
	const allCategories = await db.select().from(categories).orderBy(categories.displayOrder);

	const categorySlugs = allCategories.map((c) => c.slug);

	if (categorySlugs.length === 0) {
		return { categories: [] };
	}

	// Single query to get all permissions for this group across all categories
	const perms = await db
		.select({
			categorySlug: categoryPermissions.categorySlug,
			canRead: categoryPermissions.canRead
		})
		.from(categoryPermissions)
		.where(eq(categoryPermissions.groupSlug, groupSlug));

	// Build a lookup map from the permissions query
	const permMap = new Map(perms.map((p) => [p.categorySlug, p.canRead]));

	// Apply role-based defaults when no permission row exists
	const isPrivileged = groupSlug === 'admin' || groupSlug === 'moderator';
	const defaultCanRead = groupSlug === 'guest' ? true : true; // guests can read public, members can read

	const readableCategories = isPrivileged
		? allCategories
		: allCategories.filter((cat) => {
				const canRead = permMap.get(cat.slug);
				return canRead === undefined ? defaultCanRead : canRead;
			});

	return {
		categories: readableCategories
	};
};
