import type { PageServerLoad } from './$types';
import { categories, categoryPermissions } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
	const db = locals.db;
	const user = locals.user;
	const groupSlug = user?.groupSlug || 'member';

	// Fetch categories ordered by displayOrder
	const allCategories = await db.select().from(categories).orderBy(categories.displayOrder);

	// Filter by permissions
	const readableCategories = [];
	for (const cat of allCategories) {
		const perm = await db
			.select()
			.from(categoryPermissions)
			.where(
				and(
					eq(categoryPermissions.categorySlug, cat.slug),
					eq(categoryPermissions.groupSlug, groupSlug)
				)
			)
			.limit(1);

		const canRead = perm.length === 0 ? true : perm[0].canRead;
		if (canRead) {
			readableCategories.push(cat);
		}
	}

	return {
		categories: readableCategories
	};
};
