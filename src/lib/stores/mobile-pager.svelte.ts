/**
 * Pager Store factory - bridges a horizontal pager's drag state to its
 * indicator bar so the indicator tracks the finger live (instead of only
 * snapping on release). The pager is the sole writer; the bar reads.
 *
 * `fractionalIndex` is the active panel plus a fractional drag offset (e.g.
 * 0.5 = halfway from panel 0 to panel 1); at rest it equals the active index.
 * `dragging` is true while a pointer is actively dragging (the bar drops its
 * CSS transition then so the indicator follows 1:1). `active` marks that a
 * pager is mounted and driving - until then the bar falls back to the URL so a
 * deep link renders correctly before hydration.
 *
 * `backMorph` drives the Header's layer morph during a swipe-back on a deep /
 * search page. It is the swipe-back progress 0..1 (0 at rest on the current
 * page, 1 once committed toward the source), written frame-synced with
 * `fractionalIndex` by GesturePageLayout. null everywhere a swipe-back is not
 * in progress (root tab routes, before mount): the Header then falls back to a
 * URL-derived default so a deep link SSRs in the right mode without waiting for
 * hydration.
 *
 * Factory: two pagers exist - the PRIMARY tab pager (MobileTabPager /
 * GesturePageLayout write; Header / MobileTabBar read) and the SEARCH scope
 * pager (SearchScopePager writes; SearchTabBar reads). Each `createPagerStore()`
 * call holds its OWN closure-scoped `$state` so the two never cross-wire. The
 * instances are created once at module load and returned by the getters.
 */
import { setContext, getContext } from 'svelte';

interface PagerUpdate {
	fractionalIndex: number;
	dragging: boolean;
	active: boolean;
	backMorph: number | null;
	targetIndex?: number | null;
}

type SetPagerFn = (update: PagerUpdate) => void;

interface PagerStore extends PagerUpdate {
	targetIndex: number | null;
	set: SetPagerFn;
}

export function createPagerStore(): PagerStore {
	let fractionalIndex = $state(0);
	let dragging = $state(false);
	let active = $state(false);
	let backMorph = $state<number | null>(null);
	let targetIndex = $state<number | null>(null);

	function set(update: PagerUpdate): void {
		fractionalIndex = update.fractionalIndex;
		dragging = update.dragging;
		active = update.active;
		backMorph = update.backMorph;
		targetIndex = update.targetIndex !== undefined ? update.targetIndex : null;
	}

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
		get backMorph() {
			return backMorph;
		},
		get targetIndex() {
			return targetIndex;
		},
		set
	};
}

const MOBILE_PAGER_KEY = Symbol('MOBILE_PAGER');
const SEARCH_PAGER_KEY = Symbol('SEARCH_PAGER');

declare global {
	interface Window {
		__primaryPager?: PagerStore;
		__searchPager?: PagerStore;
	}
}

let globalMobilePagerFallback: PagerStore | undefined;
let globalSearchPagerFallback: PagerStore | undefined;

if (typeof window !== 'undefined') {
	if (window.__primaryPager) globalMobilePagerFallback = window.__primaryPager;
	if (window.__searchPager) globalSearchPagerFallback = window.__searchPager;
}

export function initMobilePagerStore(): PagerStore {
	const store = createPagerStore();
	setContext(MOBILE_PAGER_KEY, store);
	if (typeof window !== 'undefined') {
		globalMobilePagerFallback = store;
		window.__primaryPager = store;
	}
	return store;
}

export function getMobilePagerStore(): PagerStore {
	try {
		const store = getContext<PagerStore>(MOBILE_PAGER_KEY);
		if (store) return store;
	} catch {
		// fallback for outside component lifecycle calls
	}
	if (globalMobilePagerFallback) {
		return globalMobilePagerFallback;
	}
	throw new Error(
		'MobilePagerStore context not initialized. Call initMobilePagerStore in +layout.svelte.'
	);
}

export function initSearchPagerStore(): PagerStore {
	const store = createPagerStore();
	setContext(SEARCH_PAGER_KEY, store);
	if (typeof window !== 'undefined') {
		globalSearchPagerFallback = store;
		window.__searchPager = store;
	}
	return store;
}

export function getSearchPagerStore(): PagerStore {
	try {
		const store = getContext<PagerStore>(SEARCH_PAGER_KEY);
		if (store) return store;
	} catch {
		// fallback for outside component lifecycle calls
	}
	if (globalSearchPagerFallback) {
		return globalSearchPagerFallback;
	}
	throw new Error(
		'SearchPagerStore context not initialized. Call initSearchPagerStore in +layout.svelte.'
	);
}
