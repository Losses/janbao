import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getProfileHeaderPayload } from '$lib/server/db/dao/profile';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user;
	if (!user) {
		redirect(302, `/entry/signin?redirectTo=${url.pathname}`);
	}

	const headerPayload = await getProfileHeaderPayload(locals.db, user.id);
	if (!headerPayload) {
		redirect(302, '/entry/signin');
	}

	return {
		headerPayload,
		user
	};
};
