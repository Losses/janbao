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
