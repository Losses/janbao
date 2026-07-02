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
import type { Component } from 'svelte';
import { MOBILE_TAB_DEFS, type TabDef, type MobileTabLabelKey } from './tab-config';
import { getListCacheStore } from '$lib/stores/list-cache.svelte';
import TabDiscussionsPanel from '$lib/components/panels/TabDiscussionsPanel.svelte';
import TabActivityPanel from '$lib/components/panels/TabActivityPanel.svelte';
import TabMessagesPanel from '$lib/components/panels/TabMessagesPanel.svelte';
import type { TabsLayoutData } from '$lib/types/tabs';

export type { MobileTabLabelKey, PathMatcher } from './tab-config';

type CacheCheckFn = () => boolean;
/**
 * "Is this tab's list present in the root layout data?" The root load eager-
 * loads page 1 of every tab on EVERY route, so a tab's list is available via
 * `data` even on a top-level deep page that never populated the list-cache
 * store. `MobileTab.hasData` treats a tab as available when EITHER the cache OR
 * this layout data has items. Accepts a `Partial` because `page.data` (in a
 * shared component) is typed as the broad App.PageData.
 */
type TabDataCheck = (data: Partial<TabsLayoutData>) => boolean;

const TAB_DATA_CHECKS: Record<MobileTabLabelKey, TabDataCheck> = {
	discussions: (d) => (d.home?.discussions?.length ?? 0) > 0,
	activity: (d) => (d.activity?.activities?.length ?? 0) > 0,
	messages: (d) => (d.messages?.conversations?.length ?? 0) > 0
};

// Each tab's list panel is a thin wrapper (TabDiscussionsPanel etc.) that pulls
// its cache/list data from the list-cache store and page data itself, so the
// panel slot is a single prop-less Component - not a union of the heterogeneous
// underlying Panels.
type TabListComponent = Component;

const TAB_LIST_COMPONENTS: Record<MobileTabLabelKey, TabListComponent> = {
	discussions: TabDiscussionsPanel,
	activity: TabActivityPanel,
	messages: TabMessagesPanel
};

export interface MobileTab extends TabDef {
	isActive: TabDef['isActive'];
	checkCache: CacheCheckFn;
	/** A tab's list is available when the cache OR the root-layout data has items. */
	hasData: TabDataCheck;
	panel: TabListComponent;
}

export const MOBILE_TABS: readonly MobileTab[] = MOBILE_TAB_DEFS.map((tab) => ({
	...tab,
	// The cache store owns its shape and exposes a generic populated check keyed
	// by labelKey, so no per-tab switch lives here.
	checkCache: () => getListCacheStore().isPopulated(tab.labelKey),
	hasData: (data) =>
		getListCacheStore().isPopulated(tab.labelKey) || TAB_DATA_CHECKS[tab.labelKey](data),
	panel: TAB_LIST_COMPONENTS[tab.labelKey]
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
