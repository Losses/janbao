import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getAllowSlugChange } from '$lib/server/constants';
import { buildSignInRedirectUrl } from '$lib/utils/redirect';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const user = locals.user;
	if (!user) {
		redirect(302, buildSignInRedirectUrl('/profile/edit'));
	}

	const allowSlugChange = getAllowSlugChange(platform?.env);

	return {
		allowSlugChange,
		user: {
			id: user.id,
			username: user.username,
			email: user.email,
			displayName: user.displayName,
			bio: user.bio,
			avatarUrl: user.avatarUrl,
			showEmail: user.showEmail,
			languagePreference: user.languagePreference,
			groupSlug: user.groupSlug
		}
	};
};
