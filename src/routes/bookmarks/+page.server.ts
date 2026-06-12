import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getBookmarks, getBookmarksCount } from '$lib/server/db/dao/bookmarks';
import { getDiscussionsLimit } from '$lib/server/constants';

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

	const totalPages = Math.max(1, Math.ceil(totalCount / limit));

	return {
		bookmarks: items,
		page,
		totalPages,
		totalCount
	};
};
