import type { LayoutServerLoad } from './$types';
import { countUnreadNotifications } from '$lib/server/db/dao/notifications';
import { countTotalUnreadMessages } from '$lib/server/db/dao/messages';
import { getVapidPublicKeyBase64Url } from '$lib/server/push/keys';

export const load: LayoutServerLoad = async ({ locals, depends, platform }) => {
	depends('app:badges');
	const user = locals.user;

	// Sidebar icon unread counts. Seeded into the badges store by
	// +layout.svelte. The layout load reads no params, so it is NOT re-run on
	// plain client-side navigation; callers that mutate unread state (e.g.
	// reading a conversation) invalidate 'app:badges' to force a re-fetch.
	// Logged-out users get 0.
	let unreadNotificationCount = 0;
	let unreadMessageCount = 0;
	if (user) {
		// Badge counts are non-critical: a DB/FTS hiccup here must not crash
		// the whole layout (and therefore the entire app). Run the two counts
		// independently via allSettled so one failing does not mask the other,
		// and fall back to 0 on rejection.
		const [notifications, messages] = await Promise.allSettled([
			countUnreadNotifications(locals.db, user.id),
			countTotalUnreadMessages(locals.db, user.id)
		]);
		if (notifications.status === 'fulfilled') {
			unreadNotificationCount = notifications.value;
		} else {
			console.error('[badges] countUnreadNotifications failed:', notifications.reason);
		}
		if (messages.status === 'fulfilled') {
			unreadMessageCount = messages.value;
		} else {
			console.error('[badges] countTotalUnreadMessages failed:', messages.reason);
		}
	}

	return {
		user,
		lang: locals.lang,
		t: locals.t,
		unreadNotificationCount,
		unreadMessageCount,
		// VAPID public key (base64url) for the browser PushManager. Safe to expose:
		// it is the public half of the VAPID ECDSA keypair and is also embedded in
		// every push subscription. Null when VAPID is not configured and we are not
		// in a dev build; the client treats null as "push unavailable".
		vapidPublicKey: getVapidPublicKeyBase64Url(platform?.env)
	};
};
