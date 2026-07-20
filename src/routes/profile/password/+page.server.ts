import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { buildSignInRedirectUrl } from '$lib/utils/redirect';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) {
		redirect(302, buildSignInRedirectUrl('/profile/password'));
	}

	return {};
};
