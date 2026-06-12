import type { PageServerLoad } from './$types';
import { categories, categoryPermissions } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
	const db = locals.db;
	const user = locals.user;
	const groupSlug = user?.groupSlug || 'member';

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

	// Filter: if no permission row exists, default to true (matching the original logic)
	const readableCategories = allCategories.filter((cat) => {
		const canRead = permMap.get(cat.slug);
		return canRead === undefined ? true : canRead;
	});

	return {
		categories: readableCategories
	};
};
