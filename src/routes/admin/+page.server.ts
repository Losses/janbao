import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { buildSignInRedirectUrl } from '$lib/utils/redirect';

export const load: PageServerLoad = async ({ request, locals }) => {
	const user = locals.user;
	if (!user) {
		redirect(302, buildSignInRedirectUrl('/admin'));
	}

	const ua = request.headers.get('user-agent') || '';
	const isMobile = /mobile|android|iphone|ipad|phone/i.test(ua);

	if (!isMobile) {
		redirect(302, '/admin/user-groups');
	}

	return {
		user
	};
};
