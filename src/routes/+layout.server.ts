import type { LayoutServerLoad } from './$types';
import { countUnreadNotifications } from '$lib/server/db/dao/notifications';
import { countTotalUnreadMessages } from '$lib/server/db/dao/messages';
import { getVapidPublicKeyBase64Url } from '$lib/server/push/keys';
import { loadDiscussionsPage } from '$lib/server/db/dao/discussions';
import { loadActivityPage, type ActivityPageResult } from '$lib/server/db/dao/activities';
import { getConversations } from '$lib/server/db/dao/messages';
import {
	parseDiscussionPageFromPath,
	resolveGroupSlug,
	getDiscussionsLimit,
	getAllowGuestActivity
} from '$lib/server/constants';
import type { MessagesTabData } from '$lib/types/tabs';

// Fault-tolerance fallbacks: a DB/FTS hiccup in any one of these must not crash
// the whole layout (and therefore the entire app). Each Promise.allSettled slot
// falls back to its empty shape on rejection.
const EMPTY_HOME = { discussions: [], page: 1, totalPages: 1, totalCount: 0 };
const EMPTY_ACTIVITY: ActivityPageResult = {
	activities: [],
	page: 1,
	totalPages: 1,
	totalCount: 0,
	activityDraft: null,
	mentionedUsers: {}
};
const EMPTY_MESSAGES: MessagesTabData = {
	conversations: [],
	page: 1,
	totalPages: 1,
	totalCount: 0
};

export const load: LayoutServerLoad = async (event) => {
	const { locals, depends, platform, request } = event;
	depends('app:badges');
	const user = locals.user;
	const ua = request.headers.get('user-agent') || '';
	const isMobile = /mobile|android|iphone|ipad|phone/i.test(ua);

	// Eager-load page 1 of all three primary tabs on EVERY route (previously the
	// `(tabs)` layout's load, which only ran for tab roots). Top-level deep pages
	// (`/discussion/*`, `/messages/[id]`, ...) are NOT under `(tabs)`, so they
	// never received this data and their swipe-back previews were cold-cache
	// loading chips. Loading it at the root exposes the lists via `data` on every
	// route, so deep pages render real previews (`cache ?? data`) and the swipe's
	// "is the data available?" check is true. Input-free on
	// `url`, so SvelteKit reuses the result across navigations (no per-nav
	// refetch); the active tab's `?page` pagination still comes from the
	// per-route page loads.
	const platformEnv = platform?.env;
	const groupSlug = resolveGroupSlug(user);
	const { limit: homeLimit } = parseDiscussionPageFromPath(undefined, platformEnv);
	const messagesLimit = getDiscussionsLimit(platformEnv);
	const guestActivityAllowed = getAllowGuestActivity(platformEnv);

	// Sidebar unread counts + the three tab lists, all in parallel, each
	// independently fault-tolerant (one failing does not mask the others).
	const [notifR, msgBadgeR, homeR, activityR, messagesR] = await Promise.allSettled([
		user ? countUnreadNotifications(locals.db, user.id) : Promise.resolve(0),
		user ? countTotalUnreadMessages(locals.db, user.id) : Promise.resolve(0),
		loadDiscussionsPage(locals.db, {
			userId: user?.id ?? null,
			limit: homeLimit,
			offset: 0,
			groupSlug
		}),
		!user && !guestActivityAllowed
			? Promise.resolve<ActivityPageResult>(EMPTY_ACTIVITY)
			: loadActivityPage(locals.db, { userId: user?.id ?? null, page: 1, platformEnv }),
		user
			? getConversations(locals.db, user.id, { limit: messagesLimit, offset: 0 })
			: Promise.resolve({ items: [], total: 0 })
	]);

	const unreadNotificationCount = notifR.status === 'fulfilled' ? notifR.value : 0;
	const unreadMessageCount = msgBadgeR.status === 'fulfilled' ? msgBadgeR.value : 0;
	if (notifR.status === 'rejected') {
		console.error('[badges] countUnreadNotifications failed:', notifR.reason);
	}
	if (msgBadgeR.status === 'rejected') {
		console.error('[badges] countTotalUnreadMessages failed:', msgBadgeR.reason);
	}

	const home =
		homeR.status === 'fulfilled'
			? {
					discussions: homeR.value.discussions,
					page: 1,
					totalPages: homeR.value.totalPages,
					totalCount: homeR.value.totalCount
				}
			: EMPTY_HOME;
	const activity = activityR.status === 'fulfilled' ? activityR.value : EMPTY_ACTIVITY;
	const messages =
		messagesR.status === 'fulfilled'
			? {
					conversations: messagesR.value.items,
					page: 1,
					totalPages: Math.max(1, Math.ceil(messagesR.value.total / messagesLimit)),
					totalCount: messagesR.value.total
				}
			: EMPTY_MESSAGES;

	return {
		user,
		lang: locals.lang,
		t: locals.t,
		unreadNotificationCount,
		unreadMessageCount,
		isMobile,
		// VAPID public key (base64url) for the browser PushManager. Safe to expose:
		// it is the public half of the VAPID ECDSA keypair and is also embedded in
		// every push subscription. Null when VAPID is not configured and we are not
		// in a dev build; the client treats null as "push unavailable".
		vapidPublicKey: getVapidPublicKeyBase64Url(platformEnv),
		// The three tab lists (page 1), seeded into the page cache by
		// +layout.svelte so deep pages have swipe-preview data.
		home,
		activity,
		messages
	};
};
