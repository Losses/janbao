import type { PageServerLoad } from './$types';
import { getDiscussionsList, getDiscussionsCount } from '$lib/server/db/dao/discussions';
import { checkAndCreateWelcomePost } from '$lib/server/db/welcome';

export const load: PageServerLoad = async (event) => {
	const db = event.locals.db;
	const user = event.locals.user;
	const platformEnv = event.platform?.env;

	// 1. Daily Welcome Post Check (Runs on home page access)
	await checkAndCreateWelcomePost(db, platformEnv);

	// 2. Parse pagination
	const pageParam = event.url.searchParams.get('page');
	let page = pageParam ? parseInt(pageParam, 10) : 1;
	if (isNaN(page) || page < 1) {
		page = 1;
	}

	const limit = 20; // DISCUSSIONS_LIMIT
	const offset = (page - 1) * limit;

	// 3. Fetch discussions list
	const discussionsList = await getDiscussionsList(db, {
		userId: user?.id || null,
		limit,
		offset
	});

	const totalCount = await getDiscussionsCount(db);
	const totalPages = Math.ceil(totalCount / limit);

	return {
		discussions: discussionsList,
		page,
		totalPages,
		totalCount
	};
};
