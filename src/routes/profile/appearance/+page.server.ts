import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) {
		redirect(302, '/entry/signin?redirectTo=/profile/appearance');
	}

	// UI prefs ride on the session (hooks.server.ts loads them once per
	// authed request), so there is no extra query here.
	return { uiPreferences: user.uiPreferences };
};
