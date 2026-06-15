import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loadDiscussionsPage } from '$lib/server/db/dao/discussions';
import { parseDiscussionPageFromPath, resolveGroupSlug } from '$lib/server/constants';

export const load: PageServerLoad = async (event) => {
	const db = event.locals.db;
	const user = event.locals.user;
	const platformEnv = event.platform?.env;
	const groupSlug = resolveGroupSlug(user);

	const { page, limit, offset } = parseDiscussionPageFromPath(event.params.page, platformEnv);

	// Page 1 canonically lives at "/" — collapse /discussions and /discussions/p1 back home.
	if (page <= 1) {
		redirect(308, '/');
	}

	const { discussions, totalPages, totalCount } = await loadDiscussionsPage(db, {
		userId: user?.id ?? null,
		limit,
		offset,
		groupSlug
	});

	return {
		discussions,
		page,
		totalPages,
		totalCount
	};
};
