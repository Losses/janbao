/**
 * The primary mobile destinations, shared by the in-App-Bar tab strip
 * (MobileTabBar) and the page-content swipe-to-switch logic
 * (DualColumnLayout). Keeping the list in one place guarantees the visible
 * tabs, their order, and the swipe-neighbour mapping never drift apart.
 *
 * The tab definitions themselves live in tab-config.ts (pure, runes-free) so
 * navigation-logic can share them without pulling in this module's cache store.
 * Here we layer the browser-only `checkCache` on top.
 *
 * The Discussions tab covers the discussion list (`/`, `/discussions/pN`) AND a
 * thread view (`/discussion/[id]/...`) - all share the same primary section.
 */
import { MOBILE_TAB_DEFS, type TabDef } from './tab-config';
import { getListCacheStore } from '$lib/stores/list-cache.svelte';

export type { MobileTabLabelKey, PathMatcher } from './tab-config';

type CacheCheckFn = () => boolean;

export interface MobileTab extends TabDef {
	isActive: TabDef['isActive'];
	checkCache: CacheCheckFn;
}

export const MOBILE_TABS: readonly MobileTab[] = MOBILE_TAB_DEFS.map((tab) => ({
	...tab,
	// The cache store owns its shape and exposes a generic populated check keyed
	// by labelKey, so no per-tab switch lives here.
	checkCache: () => getListCacheStore().isPopulated(tab.labelKey)
}));

/** Index of the active tab for the given pathname, or -1 when on no tab route. */
export function getCurrentTabIndex(pathname: string): number {
	return MOBILE_TABS.findIndex((tab) => tab.isActive(pathname));
}

/**
 * The tab a reading/list page "belongs to", so a left/right swipe on an inner
 * page can switch to the next/prev tab. Reuses the tab matchers (so
 * /discussion/* -> Discussions, /messages/* -> Messages), then maps the offline
 * readers (which are not tab routes) to their online counterpart. -1 when the
 * page has no tab association (no swipe there).
 */
export function getSwipeBaseline(pathname: string): number {
	const idx = getCurrentTabIndex(pathname);
	if (idx >= 0) return idx;
	if (pathname.startsWith('/offline/activity')) return 1;
	if (pathname.startsWith('/offline')) return 0;
	return -1;
}

/** True for the exact pager routes (where the MobileTabPager owns the swipe). */
export function isPagerRoute(pathname: string): boolean {
	return MOBILE_TABS.some((tab) => tab.href === pathname);
}
