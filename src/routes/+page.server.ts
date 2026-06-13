import type { PageServerLoad } from './$types';
import { getDiscussionsList, getDiscussionsCount } from '$lib/server/db/dao/discussions';
import { checkAndCreateWelcomePost } from '$lib/server/db/welcome';
import { parseDiscussionPagination, resolveGroupSlug } from '$lib/server/constants';

export const load: PageServerLoad = async (event) => {
	const db = event.locals.db;
	const user = event.locals.user;
	const platformEnv = event.platform?.env;
	const groupSlug = resolveGroupSlug(user);

	// 1. Daily Welcome Post Check (Runs on home page access)
	await checkAndCreateWelcomePost(db, platformEnv);

	// 2. Parse pagination
	const { page, limit, offset } = parseDiscussionPagination(event.url, platformEnv);

	// 3. Fetch discussions list (filtered by category read permissions)
	const discussionsList = await getDiscussionsList(db, {
		userId: user?.id || null,
		limit,
		offset,
		groupSlug
	});

	const totalCount = await getDiscussionsCount(db, { groupSlug });
	const totalPages = Math.ceil(totalCount / limit);

	return {
		discussions: discussionsList,
		page,
		totalPages,
		totalCount
	};
};
