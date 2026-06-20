import type { LayoutServerLoad } from './$types';
import { loadDiscussionsPage } from '$lib/server/db/dao/discussions';
import { loadActivityPage } from '$lib/server/db/dao/activities';
import { getConversations } from '$lib/server/db/dao/messages';
import {
	parseDiscussionPageFromPath,
	resolveGroupSlug,
	getDiscussionsLimit
} from '$lib/server/constants';
import type { MessagesTabData, TabsLayoutData } from '$lib/types/tabs';

/**
 * Eager-loads all three tabs at page 1 so the mobile pager can mount every panel
 * up front (1:1 swipe with live reveal + preserved state). Input-free on `url`
 * so SvelteKit reuses the result across sibling navigations - swiping between
 * tabs does NOT refetch. The active tab's `?page` pagination is still served by
 * the per-route page loads; `t` / `user` are inherited from the root layout via
 * the data cascade.
 */
export const load: LayoutServerLoad = async (event) => {
	const db = event.locals.db;
	const platformEnv = event.platform?.env;
	const user = event.locals.user;
	const groupSlug = resolveGroupSlug(user);

	const { limit: homeLimit } = parseDiscussionPageFromPath(undefined, platformEnv);
	const messagesLimit = getDiscussionsLimit(platformEnv);

	const [home, activity, messages] = await Promise.all([
		loadDiscussionsPage(db, {
			userId: user?.id ?? null,
			limit: homeLimit,
			offset: 0,
			groupSlug
		}).then((r) => ({
			discussions: r.discussions,
			page: 1,
			totalPages: r.totalPages,
			totalCount: r.totalCount
		})),
		loadActivityPage(db, { userId: user?.id ?? null, page: 1, platformEnv }),
		user
			? getConversations(db, user.id, { limit: messagesLimit, offset: 0 }).then(
					(r): MessagesTabData => ({
						conversations: r.items,
						page: 1,
						totalPages: Math.max(1, Math.ceil(r.total / messagesLimit)),
						totalCount: r.total
					})
				)
			: Promise.resolve<MessagesTabData>({
					conversations: [],
					page: 1,
					totalPages: 1,
					totalCount: 0
				})
	]);

	const tabs: TabsLayoutData = { home, activity, messages };
	return tabs;
};
