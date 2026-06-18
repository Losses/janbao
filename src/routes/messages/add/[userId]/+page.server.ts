import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolveMessageComposePrefill } from '$lib/server/messages';

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) {
		redirect(302, '/entry/signin');
	}

	// Prefill the recipient from the route param. URL is preserved on this
	// route (it is a real page, not a redirect) so /messages/add/<userId> is a
	// stable, shareable entry point that opens the compose UI pre-addressed.
	const recipientId = Number(event.params.userId);
	return resolveMessageComposePrefill(event.locals.db, user.id, recipientId);
};
