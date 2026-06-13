import type { LayoutServerLoad } from './$types';
import { countUnreadNotifications } from '$lib/server/db/dao/notifications';
import { countTotalUnreadMessages } from '$lib/server/db/dao/messages';

export const load: LayoutServerLoad = async ({ locals }) => {
	const user = locals.user;

	// Sidebar icon unread counts. Fetched once per navigation (no polling) and
	// seeded into the badges store by +layout.svelte. Logged-out users get 0.
	let unreadNotificationCount = 0;
	let unreadMessageCount = 0;
	if (user) {
		[unreadNotificationCount, unreadMessageCount] = await Promise.all([
			countUnreadNotifications(locals.db, user.id),
			countTotalUnreadMessages(locals.db, user.id)
		]);
	}

	return {
		user,
		lang: locals.lang,
		t: locals.t,
		unreadNotificationCount,
		unreadMessageCount
	};
};
