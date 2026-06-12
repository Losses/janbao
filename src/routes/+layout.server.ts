import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		user: locals.user,
		lang: locals.lang,
		t: locals.t
	};
};
