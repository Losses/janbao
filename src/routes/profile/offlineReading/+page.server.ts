import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// DV07 C03 - Offline Reading settings. Decision #5: auth-only; guests cannot
// enter. The prefs themselves live client-side (decision #1: per-device
// localStorage) so the server load does not query them - it only gates auth and
// lets the inherited root-layout `data.t` / `data.user` flow into the page like
// every other `/profile/*` route. A minimal marker is returned so the load is
// not flagged as empty.
export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) {
		redirect(302, '/entry/signin?redirectTo=/profile/offlineReading');
	}

	return {
		section: 'offlineReading' as const
	};
};
