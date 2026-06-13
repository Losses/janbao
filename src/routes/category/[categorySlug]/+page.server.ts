import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { categories } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getDiscussionsList, getDiscussionsCount } from '$lib/server/db/dao/discussions';
import {
	parseDiscussionPagination,
	resolvePermissions,
	resolveGroupSlug
} from '$lib/server/constants';

export const load: PageServerLoad = async (event) => {
	const { categorySlug } = event.params;
	const db = event.locals.db;
	const user = event.locals.user;

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

	// 2. Check read permissions (guest-safe via resolvePermissions)
	const perms = await resolvePermissions(db, categorySlug, user);
	if (!perms.canRead) {
		error(403, event.locals.t.common.forbidden);
	}

	// 3. Parse page
	const { page, limit, offset } = parseDiscussionPagination(event.url, event.platform?.env);

	// 4. Fetch discussions list in this category
	const groupSlug = resolveGroupSlug(user);

	const discussionsList = await getDiscussionsList(db, {
		userId: user?.id || null,
		categorySlug,
		groupSlug,
		limit,
		offset
	});

	const totalCount = await getDiscussionsCount(db, { categorySlug, groupSlug });
	const totalPages = Math.ceil(totalCount / limit);

	return {
		category,
		discussions: discussionsList,
		page,
		totalPages,
		totalCount
	};
};
