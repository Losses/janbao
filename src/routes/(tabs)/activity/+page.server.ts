import type { PageServerLoad } from './$types';
import { loadActivityPage } from '$lib/server/db/dao/activities';

export const load: PageServerLoad = async (event) => {
	const pageParam = event.url.searchParams.get('page');
	let page = pageParam ? parseInt(pageParam, 10) : 1;
	if (isNaN(page) || page < 1) {
		page = 1;
	}

	return loadActivityPage(event.locals.db, {
		userId: event.locals.user?.id ?? null,
		page,
		platformEnv: event.platform?.env
	});
};
