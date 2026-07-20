import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getProfileHeaderPayload } from '$lib/server/db/dao/profile';
import { buildSignInRedirectUrl } from '$lib/utils/redirect';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user;
	if (!user) {
		redirect(302, buildSignInRedirectUrl(url.pathname));
	}

	const headerPayload = await getProfileHeaderPayload(locals.db, user.id);
	if (!headerPayload) {
		// Authenticated user with a missing own-profile row. NOT an auth gate,
		// so no `redirectTo`: a return-to-`/profile` would loop forever because
		// the missing-row condition persists across sign-in.
		redirect(302, '/entry/signin');
	}

	return {
		headerPayload,
		user
	};
};
