/**
 * Mobile Pager Store - bridges the MobileTabPager's drag state to the
 * MobileTabBar so the tab indicator tracks the finger live (instead of only
 * snapping on release). The pager is the sole writer; the tab bar reads.
 *
 * `fractionalIndex` is the active tab plus a fractional drag offset (e.g. 0.5
 * = halfway from tab 0 to tab 1); at rest it equals the active tab index.
 * `dragging` is true while a pointer is actively dragging (the tab bar drops
 * its CSS transition then so the indicator follows 1:1). `active` marks that
 * the pager is mounted and driving - until then the tab bar falls back to the
 * URL's tab so a deep link renders correctly before hydration.
 *
 * `deepMorph` drives the Header's hamburger<->back-arrow morph on deep pages
 * (routes with no tab highlight). It is the swipe-back gesture progress 0..1
 * (0 at rest on a deep page = full back arrow, 1 once committed = full
 * hamburger), written by GesturePageLayout in the SAME branch that writes
 * fractionalIndex so it is frame-synced with the tab pill. null everywhere a
 * deep-page swipe-back is not in progress (tab routes, thread/conversation
 * pages, before mount): the Header then falls back to a URL-derived default so
 * a deep link SSRs in deep mode without waiting for hydration.
 */
interface PagerUpdate {
	fractionalIndex: number;
	dragging: boolean;
	active: boolean;
	deepMorph: number | null;
}

type SetPagerFn = (update: PagerUpdate) => void;

interface MobilePagerStore extends PagerUpdate {
	set: SetPagerFn;
}

let fractionalIndex = $state(0);
let dragging = $state(false);
let active = $state(false);
let deepMorph = $state<number | null>(null);

function set(update: PagerUpdate): void {
	fractionalIndex = update.fractionalIndex;
	dragging = update.dragging;
	active = update.active;
	deepMorph = update.deepMorph;
}

export function getMobilePagerStore(): MobilePagerStore {
	return {
		get fractionalIndex() {
			return fractionalIndex;
		},
		get dragging() {
			return dragging;
		},
		get active() {
			return active;
		},
		get deepMorph() {
			return deepMorph;
		},
		set
	};
}
