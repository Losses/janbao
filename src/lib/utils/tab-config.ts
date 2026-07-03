import { mdiForum, mdiLightningBolt, mdiEmailOutline } from '@mdi/js';

/**
 * tab-config - the pure (runes-free) source of truth for the primary mobile
 * tabs and the global non-tab routes. Shared by:
 *   - route-config.ts, which layers the browser-only bits on top (the list-cache
 *     populated check, the list panel component, and the config-driven
 *     route->tab resolution), and
 *   - navigation-logic.ts (stores/navigation-logic.ts), which derives tab count,
 *     root hrefs, and the path->tab mapping from it instead of hardcoding the
 *     site's directory structure.
 *
 * tab-config stays pure (no Svelte component or store imports) because
 * navigation-logic is unit-tested under bun:test with no runes loader.
 *
 * Adding/removing/reordering a tab is a one-line change here; every consumer
 * (tab bar, pager, gesture layout, back-swipe target) follows automatically.
 */

export type MobileTabLabelKey = 'discussions' | 'activity' | 'messages';

/** Predicate matching a pathname to a tab (covers the tab root + its sub-routes). */
export type PathMatcher = (pathname: string) => boolean;

/**
 * A prefix matches a pathname exactly OR as a directory prefix (prefix + '/'),
 * so '/discussion' covers '/discussion/123' but not '/discussions/pN'. Each tab
 * declares its prefixes as data; isActive is derived, never hand-written per tab.
 */
function prefixMatcher(prefixes: readonly string[]): PathMatcher {
	return (p) => prefixes.some((pre) => p === pre || p.startsWith(`${pre}/`));
}

export interface TabDef {
	/** Root href of the tab, also its pager route. */
	href: string;
	labelKey: MobileTabLabelKey;
	icon: string;
	/** Route prefixes this tab covers (its root + sub-routes); drives isActive. */
	prefixes: readonly string[];
	/** Matches this tab's root and all of its sub-routes. Derived from prefixes. */
	isActive: PathMatcher;
	/** Root-layout data key holding this tab's list (a TabsLayoutData key). */
	dataKey: string;
	/** Field under dataKey holding the list items. */
	listKey: string;
	/**
	 * Optional deep route the forward edge commits to when this tab is the last
	 * primary tab. With this field set, a right-edge swipe past the tab enters
	 * the route; without it, the edge rubber-bands. Set only on the rightmost
	 * tab that should hand off to a deep page.
	 */
	forwardDeepNeighbour?: string;
}

interface TabDefData {
	href: string;
	labelKey: MobileTabLabelKey;
	icon: string;
	prefixes: readonly string[];
	dataKey: string;
	listKey: string;
	forwardDeepNeighbour?: string;
}

const RAW_TAB_DEFS: readonly TabDefData[] = [
	{
		href: '/',
		labelKey: 'discussions',
		icon: mdiForum,
		prefixes: ['/', '/discussion'],
		dataKey: 'home',
		listKey: 'discussions'
	},
	{
		href: '/activity',
		labelKey: 'activity',
		icon: mdiLightningBolt,
		prefixes: ['/activity'],
		dataKey: 'activity',
		listKey: 'activities'
	},
	{
		href: '/messages/inbox',
		labelKey: 'messages',
		icon: mdiEmailOutline,
		prefixes: ['/messages'],
		dataKey: 'messages',
		listKey: 'conversations',
		forwardDeepNeighbour: '/search'
	}
];

/** The ordered primary tabs. Length is the canonical tab count. */
export const MOBILE_TAB_DEFS: readonly TabDef[] = RAW_TAB_DEFS.map((tab) => ({
	href: tab.href,
	labelKey: tab.labelKey,
	icon: tab.icon,
	prefixes: tab.prefixes,
	isActive: prefixMatcher(tab.prefixes),
	dataKey: tab.dataKey,
	listKey: tab.listKey,
	forwardDeepNeighbour: tab.forwardDeepNeighbour
}));

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
