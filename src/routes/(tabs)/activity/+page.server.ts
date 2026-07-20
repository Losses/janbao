import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loadActivityPage } from '$lib/server/db/dao/activities';
import { getAllowGuestActivity } from '$lib/server/constants';
import { buildSignInRedirectUrl } from '$lib/utils/redirect';

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user && !getAllowGuestActivity(event.platform?.env)) {
		redirect(302, buildSignInRedirectUrl(event.url.pathname));
	}

	const pageParam = event.url.searchParams.get('page');
	let page = pageParam ? parseInt(pageParam, 10) : 1;
	if (isNaN(page) || page < 1) {
		page = 1;
	}

	return loadActivityPage(event.locals.db, {
		userId: user?.id ?? null,
		page,
		platformEnv: event.platform?.env
	});
};
