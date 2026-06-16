import type { PageServerLoad } from './$types';
import { loadDiscussionsPage } from '$lib/server/db/dao/discussions';
import { parseDiscussionPageFromPath, resolveGroupSlug } from '$lib/server/constants';

export const load: PageServerLoad = async (event) => {
	const db = event.locals.db;
	const user = event.locals.user;
	const platformEnv = event.platform?.env;
	const groupSlug = resolveGroupSlug(user);

	// 1. Home is always page 1 - deeper pages live at /discussions/pN
	const { limit, offset } = parseDiscussionPageFromPath(undefined, platformEnv);

	// 3. Fetch discussions list (filtered by category read permissions)
	const { discussions, totalPages, totalCount } = await loadDiscussionsPage(db, {
		userId: user?.id ?? null,
		limit,
		offset,
		groupSlug
	});

	return {
		discussions,
		page: 1,
		totalPages,
		totalCount
	};
};
