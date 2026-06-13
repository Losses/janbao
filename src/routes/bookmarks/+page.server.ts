import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getBookmarks, getBookmarksCount } from '$lib/server/db/dao/bookmarks';
import { categoryPermissions } from '$lib/server/db/schema';
import { getDiscussionsLimit, resolveGroupSlug } from '$lib/server/constants';
import { and, eq, inArray } from 'drizzle-orm';

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) {
		redirect(302, '/entry/signin');
	}

	const limit = getDiscussionsLimit(event.platform?.env);

	const pageParam = event.url.searchParams.get('page');
	let page = pageParam ? parseInt(pageParam, 10) : 1;
	if (isNaN(page) || page < 1) page = 1;
	const offset = (page - 1) * limit;

	const [items, totalCount] = await Promise.all([
		getBookmarks(event.locals.db, user.id, { limit, offset }),
		getBookmarksCount(event.locals.db, user.id)
	]);

	// Filter out bookmarks whose category the user can no longer read
	const groupSlug = resolveGroupSlug(user);
	const uniqueCategorySlugs = [...new Set(items.map((item) => item.categorySlug))];

	let readableSlugs: Set<string>;
	if (uniqueCategorySlugs.length === 0) {
		readableSlugs = new Set();
	} else {
		const permRows = await event.locals.db
			.select({
				categorySlug: categoryPermissions.categorySlug,
				canRead: categoryPermissions.canRead
			})
			.from(categoryPermissions)
			.where(
				and(
					inArray(categoryPermissions.categorySlug, uniqueCategorySlugs),
					eq(categoryPermissions.groupSlug, groupSlug)
				)
			);

		const deniedSlugs = new Set(permRows.filter((r) => !r.canRead).map((r) => r.categorySlug));
		readableSlugs = new Set(uniqueCategorySlugs.filter((s) => !deniedSlugs.has(s)));
	}

	const filteredItems = items.filter((item) => readableSlugs.has(item.categorySlug));

	const totalPages = Math.max(1, Math.ceil(totalCount / limit));

	return {
		bookmarks: filteredItems,
		page,
		totalPages,
		totalCount
	};
};
