import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getConversations } from '$lib/server/db/dao/messages';
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

	const { items, total } = await getConversations(event.locals.db, user.id, { limit, offset });
	const totalPages = Math.max(1, Math.ceil(total / limit));

	return {
		conversations: items,
		page,
		totalPages,
		totalCount: total
	};
};
