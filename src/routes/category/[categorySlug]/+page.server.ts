import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { categories, categoryPermissions } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { getDiscussionsList, getDiscussionsCount } from '$lib/server/db/dao/discussions';
import { parseDiscussionPagination } from '$lib/server/constants';

export const load: PageServerLoad = async (event) => {
	const { categorySlug } = event.params;
	const db = event.locals.db;
	const user = event.locals.user;
	const groupSlug = user?.groupSlug || 'member';

	// 1. Fetch category
	const categoryRecords = await db
		.select()
		.from(categories)
		.where(eq(categories.slug, categorySlug))
		.limit(1);

	if (categoryRecords.length === 0) {
		error(404, event.locals.t.category.notFound);
	}
	const category = categoryRecords[0];

	// 2. Check read permissions
	const perm = await db
		.select()
		.from(categoryPermissions)
		.where(
			and(
				eq(categoryPermissions.categorySlug, categorySlug),
				eq(categoryPermissions.groupSlug, groupSlug)
			)
		)
		.limit(1);

	const canRead = perm.length === 0 ? true : perm[0].canRead;
	if (!canRead) {
		error(403, event.locals.t.common.forbidden);
	}

	// 3. Parse page
	const { page, limit, offset } = parseDiscussionPagination(event.url, event.platform?.env);

	// 4. Fetch discussions list in this category
	const discussionsList = await getDiscussionsList(db, {
		userId: user?.id || null,
		categorySlug,
		limit,
		offset
	});

	const totalCount = await getDiscussionsCount(db, { categorySlug });
	const totalPages = Math.ceil(totalCount / limit);

	return {
		category,
		discussions: discussionsList,
		page,
		totalPages,
		totalCount
	};
};
