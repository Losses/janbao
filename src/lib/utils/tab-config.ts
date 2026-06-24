import { mdiForum, mdiLightningBolt, mdiEmailOutline } from '@mdi/js';

/**
 * tab-config - the pure (runes-free) source of truth for the primary mobile
 * tabs and the global non-tab routes. Shared by:
 *   - mobile-tabs.ts, which layers the (browser-only) cache check on top, and
 *   - navigation-logic.ts (stores/navigation-logic.ts), which derives tab count,
 *     root hrefs, and the path→tab mapping from it instead of hardcoding the
 *     site's directory structure.
 *
 * Adding/removing/reordering a tab is a one-line change here; every consumer
 * (tab bar, pager, gesture layout, back-swipe target) follows automatically.
 */

export type MobileTabLabelKey = 'discussions' | 'activity' | 'messages';

/** Predicate matching a pathname to a tab (covers the tab root + its sub-routes). */
export type PathMatcher = (pathname: string) => boolean;

export interface TabDef {
	/** Root href of the tab, also its pager route. */
	href: string;
	labelKey: MobileTabLabelKey;
	icon: string;
	/** Matches this tab's root and all of its sub-routes. */
	isActive: PathMatcher;
}

/** The ordered primary tabs. Length is the canonical tab count. */
export const MOBILE_TAB_DEFS: readonly TabDef[] = [
	{
		href: '/',
		labelKey: 'discussions',
		icon: mdiForum,
		isActive: (p) => p === '/' || p.startsWith('/discussion')
	},
	{
		href: '/activity',
		labelKey: 'activity',
		icon: mdiLightningBolt,
		isActive: (p) => p.startsWith('/activity')
	},
	{
		href: '/messages/inbox',
		labelKey: 'messages',
		icon: mdiEmailOutline,
		isActive: (p) => p.startsWith('/messages')
	}
];

/**
 * Routes with no tab of their own - sidebar destinations (bookmarks, profile,
 * notifications, ...) that belong to whichever tab the user is currently on.
 * Centralized here so the navigation logic never hardcodes them.
 */
export const GLOBAL_PREFIXES: readonly string[] = [
	'/admin',
	'/profile',
	'/search',
	'/bookmarks',
	'/notifications'
];
