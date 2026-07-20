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
	// Pass null when the param is absent: Number(null) === 0, and id 0 is the
	// real bootstrap super admin, so coercing a missing param to 0 prefills
	// the admin in the compose form. The /messages/add/[userId] route is the
	// legitimate entry point for an explicit id-0 recipient.
	const recipientRaw = event.url.searchParams.get('recipient');
	const recipientId = recipientRaw === null ? null : Number(recipientRaw);
	return resolveMessageComposePrefill(event.locals.db, user.id, recipientId);
};
