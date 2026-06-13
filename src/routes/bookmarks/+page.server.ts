import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getBookmarks, getBookmarksCount } from '$lib/server/db/dao/bookmarks';
import {
	getDiscussionsLimit,
	getReadableCategorySlugs,
	resolveGroupSlug
} from '$lib/server/constants';

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) {
		redirect(302, '/entry/signin');
	}

	const db = event.locals.db;
	const limit = getDiscussionsLimit(event.platform?.env);

	const pageParam = event.url.searchParams.get('page');
	let page = pageParam ? parseInt(pageParam, 10) : 1;
	if (isNaN(page) || page < 1) page = 1;
	const offset = (page - 1) * limit;

	const groupSlug = resolveGroupSlug(user);
	const readableSlugs = await getReadableCategorySlugs(db, groupSlug);

	// null = all readable (admin/moderator), undefined/empty = nothing readable
	const filters =
		readableSlugs === null
			? undefined
			: { readableCategorySlugs: readableSlugs.length > 0 ? readableSlugs : ['__none__'] };

	const [items, totalCount] = await Promise.all([
		getBookmarks(db, user.id, { limit, offset }, filters),
		getBookmarksCount(db, user.id, filters)
	]);

	const totalPages = Math.max(1, Math.ceil(totalCount / limit));

	return {
		bookmarks: items,
		page,
		totalPages,
		totalCount
	};
};
