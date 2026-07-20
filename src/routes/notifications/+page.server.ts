import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getNotifications } from '$lib/server/db/dao/notifications';
import { buildSignInRedirectUrl } from '$lib/utils/redirect';

const LIST_LIMIT = 200;

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) {
		redirect(302, buildSignInRedirectUrl(event.url.pathname));
	}

	const notifications = await getNotifications(event.locals.db, user.id, LIST_LIMIT);

	return {
		notifications,
		hasUnread: notifications.some((n) => !n.isRead)
	};
};
