import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) {
		redirect(302, '/entry/signin?redirectTo=/profile/edit');
	}

	return {
		user: {
			username: user.username,
			email: user.email,
			displayName: user.displayName,
			showEmail: user.showEmail,
			languagePreference: user.languagePreference,
			groupSlug: user.groupSlug
		}
	};
};
