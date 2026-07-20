import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolveMessageComposePrefill } from '$lib/server/messages';
import { buildSignInRedirectUrl } from '$lib/utils/redirect';

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) {
		redirect(302, buildSignInRedirectUrl(event.url.pathname));
	}

	// Optional ?recipient=<userId> prefill (e.g. from the Active Users Wall).
	const recipientId = Number(event.url.searchParams.get('recipient'));
	return resolveMessageComposePrefill(event.locals.db, user.id, recipientId);
};
