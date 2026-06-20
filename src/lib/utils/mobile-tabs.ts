/**
 * The primary mobile destinations, shared by the in-App-Bar tab strip
 * (MobileTabBar) and the page-content swipe-to-switch logic
 * (DualColumnLayout). Keeping the list in one place guarantees the visible
 * tabs, their order, and the swipe-neighbour mapping never drift apart.
 *
 * The Discussions tab covers the discussion list (`/`, `/discussions/pN`) AND a
 * thread view (`/discussion/[id]/...`) - all share the same primary section.
 */
import { mdiForum, mdiLightningBolt, mdiEmailOutline } from '@mdi/js';

export type MobileTabLabelKey = 'discussions' | 'activity' | 'messages';

type PathMatcher = (pathname: string) => boolean;

export interface MobileTab {
	href: string;
	labelKey: MobileTabLabelKey;
	icon: string;
	isActive: PathMatcher;
}

const isDiscussions: PathMatcher = (p) => p === '/' || p.startsWith('/discussion');
const isActivity: PathMatcher = (p) => p.startsWith('/activity');
const isMessages: PathMatcher = (p) => p.startsWith('/messages');

export const MOBILE_TABS: readonly MobileTab[] = [
	{ href: '/', labelKey: 'discussions', icon: mdiForum, isActive: isDiscussions },
	{ href: '/activity', labelKey: 'activity', icon: mdiLightningBolt, isActive: isActivity },
	{ href: '/messages/inbox', labelKey: 'messages', icon: mdiEmailOutline, isActive: isMessages }
];

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
