import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getAllowSlugChange } from '$lib/server/constants';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const user = locals.user;
	if (!user) {
		redirect(302, '/entry/signin?redirectTo=/profile/edit');
	}

	const allowSlugChange = getAllowSlugChange(platform?.env);

	return {
		allowSlugChange,
		user: {
			id: user.id,
			username: user.username,
			email: user.email,
			displayName: user.displayName,
			avatarFileId: user.avatarFileId,
			showEmail: user.showEmail,
			languagePreference: user.languagePreference,
			groupSlug: user.groupSlug
		}
	};
};
