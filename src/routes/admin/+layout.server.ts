import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { buildSignInRedirectUrl } from '$lib/utils/redirect';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	const user = locals.user;
	if (!user) {
		redirect(302, buildSignInRedirectUrl(url.pathname));
	}
	if (user.groupSlug !== 'admin') {
		error(403, locals.t.common.forbidden);
	}
	return { user };
};
