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
 */
interface PagerUpdate {
	fractionalIndex: number;
	dragging: boolean;
	active: boolean;
}

type SetPagerFn = (update: PagerUpdate) => void;

interface MobilePagerStore extends PagerUpdate {
	set: SetPagerFn;
}

let fractionalIndex = $state(0);
let dragging = $state(false);
let active = $state(false);

function set(update: PagerUpdate): void {
	fractionalIndex = update.fractionalIndex;
	dragging = update.dragging;
	active = update.active;
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
		set
	};
}
