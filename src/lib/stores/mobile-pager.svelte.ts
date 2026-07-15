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
 * `fractionalIndex` by the pipeline orchestrator. null everywhere a swipe-back
 * is not in progress (root tab routes, before mount): the Header then falls
 * back to a URL-derived default so a deep link SSRs in the right mode without
 * waiting for hydration.
 *
 * `trackFractionalIndex` is the tab-host track's 1:1 fractional position (the
 * Family A FAB reads it to follow the slide across a drag, a re-grab, and the
 * first/last-tab rubber-band). Published by the orchestrator from
 * `trackTranslateX(plan, executor.progress)`; null on non-tab-host routes.
 *
 * The store carries ONLY the per-frame gesture signals the FAB layer, the
 * MobileTabBar, and the SearchTabBar read (`coverProgress`, `tapMorph`,
 * `backMorph`, `trackFractionalIndex`, `transitionTarget`, `familySwapScale`,
 * `replaceStateIntent`, `fractionalIndex`, `dragging`, `active`,
 * `targetIndex`). The Header's settle ease state (the post-release /
 * post-title-change crossfade) and the `searchScrubbing` flag live on
 * `NavStateMachine` (private class `$state`); the orchestrator's getters
 * are `$derived` pass-throughs of those fields via its `#publication`,
 * and the Header reads them directly off the orchestrator singleton
 * (see `NavPipelineOrchestrator.settleActive` / `.settleProgress` /
 * `.settleLatched` / `.settleDirection` / `.settleAwaitTitle` /
 * `.searchScrubbing`).
 *
 * Factory: two pagers exist - the PRIMARY tab pager (NavPipelineTabHost /
 * NavPipelineHost write; Header / MobileTabBar read) and the SEARCH scope
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
	/** The slide-progress signal the FAB layer reads to drive its scale,
	 * published by the pipeline orchestrator as the raw slide fraction. null =
	 * not published, so the FAB falls back to its resting fraction. Optional so
	 * non-publishing writers (SearchScopePager) compile without touching it. */
	coverProgress?: number | null;
	/** tap-morph progress 0..1 (DV17): continuous morph signal consumed by the
	 * search track/Tab group and the search-page Page-slide headroom on a tap.
	 * null = no tap scrub in flight (rest, drag). Optional so non-publishing
	 * writers compile without touching it. */
	tapMorph?: number | null;
	/** The target pathname of an in-flight pilot detail-page transition; null at
	 * rest. Read by the FAB layer to resolve the destination's FAB family/kind
	 * during the slide. Optional so non-pilot writers compile without touching
	 * it. */
	transitionTarget?: string | null;
	/** The tab-host track's 1:1 fractional position the Family A FAB reads to
	 * follow the slide. Published by the orchestrator from
	 * `trackTranslateX(plan, executor.progress)`; null on non-tab-host routes.
	 * Optional so non-publishing writers compile without touching it. */
	trackFractionalIndex?: number | null;
	/** The orchestrator-driven family-swap eased FAB scale, published each
	 * rAF tick while a route-swap family change eases on the orchestrator's
	 * own rAF. null when no family-swap ease is in flight; the FAB layer
	 * then falls through to its coverProgress / trackFractionalIndex-based
	 * resting scale. Optional so non-publishing writers (SearchScopePager)
	 * compile without touching it. */
	familySwapScale?: number | null;
	/** The icon-morph value at the non-search endpoint of an in-flight
	 * root<->search / deep<->search tap scrub (0 when that endpoint is a
	 * tab root, 1 when it is a deep page). Published once at scrub arm
	 * time and cleared when the scrub finishes. Read by the Header's
	 * `iconProgress` derivation so the hamburger <-> back-arrow morph is
	 * continuous with the track scrub: `iconProgress = tapMorph *
	 * scrubIconEndpoint`. The search endpoint contributes 0 (the search
	 * layer's hamburger), so the lerp runs from `scrubIconEndpoint` at
	 * tapMorph=1 (non-search side) toward 0 at tapMorph=0 (search side).
	 * null at rest / when no scrub is in flight. */
	scrubIconEndpoint?: number | null;
}

type SetPagerFn = (update: PagerUpdate) => void;
type SetTapMorphFn = (value: number | null) => void;
type SetReplaceStateIntentFn = (value: boolean) => void;
type SetFamilySwapScaleFn = (value: number | null) => void;
type SetScrubIconEndpointFn = (value: number | null) => void;

interface PagerStore extends PagerUpdate {
	targetIndex: number | null;
	coverProgress: number | null;
	tapMorph: number | null;
	transitionTarget: string | null;
	trackFractionalIndex: number | null;
	familySwapScale: number | null;
	scrubIconEndpoint: number | null;
	replaceStateIntent: boolean;
	set: SetPagerFn;
	setTapMorph: SetTapMorphFn;
	setReplaceStateIntent: SetReplaceStateIntentFn;
	setFamilySwapScale: SetFamilySwapScaleFn;
	setScrubIconEndpoint: SetScrubIconEndpointFn;
}

export function createPagerStore(): PagerStore {
	let fractionalIndex = $state(0);
	let dragging = $state(false);
	let active = $state(false);
	let backMorph = $state<number | null>(null);
	let targetIndex = $state<number | null>(null);
	let coverProgress = $state<number | null>(null);
	let tapMorph = $state<number | null>(null);
	let transitionTarget = $state<string | null>(null);
	let trackFractionalIndex = $state<number | null>(null);
	let familySwapScale = $state<number | null>(null);
	let scrubIconEndpoint = $state<number | null>(null);
	let replaceStateIntent = $state(false);

	function set(update: PagerUpdate): void {
		fractionalIndex = update.fractionalIndex;
		dragging = update.dragging;
		active = update.active;
		backMorph = update.backMorph;
		targetIndex = update.targetIndex !== undefined ? update.targetIndex : null;
		coverProgress = update.coverProgress ?? null;
		transitionTarget = update.transitionTarget ?? null;
		trackFractionalIndex = update.trackFractionalIndex ?? null;
		// tapMorph is omitted by the drag $effect's pager.set calls; preserve
		// it so an in-flight tap scrub is not clobbered. The tap publisher
		// writes via setTapMorph.
		tapMorph = update.tapMorph !== undefined ? update.tapMorph : tapMorph;
		// familySwapScale is owned exclusively by the orchestrator's
		// family-swap ease (published via setFamilySwapScale). Preserve it
		// across pager.set calls so resetPagerStore (fired from configure
		// and the host's at-rest $effect) does not clear a value an
		// in-flight ease just published. The orchestrator clears the field
		// explicitly via setFamilySwapScale(null) when the ease completes,
		// cancels, or tears down (releaseInputs / unmount).
		familySwapScale =
			update.familySwapScale !== undefined ? update.familySwapScale : familySwapScale;
		// scrubIconEndpoint is owned exclusively by the orchestrator's
		// tap-scrub ease (published via setScrubIconEndpoint). Preserve it
		// across pager.set calls so resetPagerStore and the in-flight drag
		// publications do not clobber a value an in-flight scrub just
		// published. The orchestrator clears the field explicitly via
		// setScrubIconEndpoint(null) when the scrub finishes, cancels, or
		// tears down (releaseInputs / unmount).
		scrubIconEndpoint =
			update.scrubIconEndpoint !== undefined ? update.scrubIconEndpoint : scrubIconEndpoint;
	}

	function setTapMorph(value: number | null): void {
		tapMorph = value;
	}

	function setReplaceStateIntent(value: boolean): void {
		replaceStateIntent = value;
	}

	function setFamilySwapScale(value: number | null): void {
		familySwapScale = value;
	}

	function setScrubIconEndpoint(value: number | null): void {
		scrubIconEndpoint = value;
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
		get coverProgress() {
			return coverProgress;
		},
		get tapMorph() {
			return tapMorph;
		},
		get transitionTarget() {
			return transitionTarget;
		},
		get trackFractionalIndex() {
			return trackFractionalIndex;
		},
		get familySwapScale() {
			return familySwapScale;
		},
		get scrubIconEndpoint() {
			return scrubIconEndpoint;
		},
		get replaceStateIntent() {
			return replaceStateIntent;
		},
		set,
		setTapMorph,
		setReplaceStateIntent,
		setFamilySwapScale,
		setScrubIconEndpoint
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
