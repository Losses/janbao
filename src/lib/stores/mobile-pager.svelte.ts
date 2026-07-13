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
 * Settle / tapScrub / searchScrubbing state: the pipeline orchestrator owns
 * the Header's settle ease (the post-release / post-title-change crossfade),
 * the root<->search and deep<->search tap-scrub ease, and the
 * `searchScrubbing` flag that freezes the Header's hamburger icon on a
 * tab-root page while a tap scrub is in flight. The orchestrator publishes
 * the eased `settleProgress`,
 * `settleLatched` (the latched transition record), `settleActive` (the
 * "settling" branch selector), `settleDirection` (forward/back), and
 * `settleAwaitTitle` (true while a commit settle holds for the navigation to
 * land) through this store; the Header reads them and renders. The
 * orchestrator is the sole writer of these fields; `set()` preserves them so
 * the in-flight settle is not clobbered by the per-frame drag publication.
 *
 * Factory: two pagers exist - the PRIMARY tab pager (NavPipelineTabHost /
 * NavPipelineHost write; Header / MobileTabBar read) and the SEARCH scope
 * pager (SearchScopePager writes; SearchTabBar reads). Each `createPagerStore()`
 * call holds its OWN closure-scoped `$state` so the two never cross-wire. The
 * instances are created once at module load and returned by the getters.
 */
import { setContext, getContext } from 'svelte';
import type { HeaderSettleTransition } from '$lib/utils/header-probe';

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
	/** Whether the last gesture release was a commit (true) or cancel
	 * (false). Set synchronously by the orchestrator's release gate via
	 * `setCommitted` so the Header's settle state machine can classify the
	 * release direction. null at rest / before any gesture. Preserved across
	 * the drag `pager.set` calls (like `tapMorph`). */
	committed?: boolean | null;
	/** The orchestrator-driven family-swap eased FAB scale, published each
	 * rAF tick while a route-swap family change eases on the orchestrator's
	 * own rAF. null when no family-swap ease is in flight; the FAB layer
	 * then falls through to its coverProgress / trackFractionalIndex-based
	 * resting scale. Optional so non-publishing writers (SearchScopePager)
	 * compile without touching it. */
	familySwapScale?: number | null;
	/** Eased settle progress 0..1 published by the orchestrator's settle
	 * rAF on the same constant-deceleration curve the executor's commit
	 * loop uses. Read by the Header's morph / titleView derivations.
	 * Optional so non-publishing writers compile without touching it. */
	settleProgress?: number;
	/** True while the orchestrator's settle ease is in flight (a
	 * gesture-release or non-gesture title change crossfade). Selects the
	 * Header's morph / titleView settle branch. */
	settleActive?: boolean;
	/** The latched endpoint identity of the in-flight settle (outgoing /
	 * incoming title + tab-ness), frozen at settle-arm time so a live
	 * `navStore.backTarget` flip mid-settle cannot reach the crossfade.
	 * null at rest. */
	settleLatched?: HeaderSettleTransition | null;
	/** The direction of the in-flight settle (forward / back). Read by the
	 * Header's titleView to choose which span slides up vs down. */
	settleDirection?: 'forward' | 'back';
	/** True while a commit settle holds at progress 1 awaiting the
	 * navigation to land. Read by the DEV probe; the production render
	 * uses `settleActive` + `settleLatched`. */
	settleAwaitTitle?: boolean;
	/** True while the orchestrator's tap-scrub ease is in flight (a
	 * root<->search or deep<->search tap). The Header's `iconProgress`
	 * freezes at the hamburger on a tab-root page while true. */
	searchScrubbing?: boolean;
}

type SetPagerFn = (update: PagerUpdate) => void;
type SetTapMorphFn = (value: number | null) => void;
type SetCommittedFn = (value: boolean | null) => void;
type SetReplaceStateIntentFn = (value: boolean) => void;
type SetFamilySwapScaleFn = (value: number | null) => void;

/** The full settle state published atomically by the orchestrator each
 *  settle-arm / rAF tick / settle-end. Fields map 1:1 to the PagerUpdate
 *  settle entries; passing `undefined` preserves the prior value. */
interface SettleStateUpdate {
	progress?: number;
	active?: boolean;
	latched?: HeaderSettleTransition | null;
	direction?: 'forward' | 'back';
	awaitTitle?: boolean;
}
type SetSettleStateFn = (update: SettleStateUpdate) => void;
type SetSearchScrubbingFn = (value: boolean) => void;

interface PagerStore extends PagerUpdate {
	targetIndex: number | null;
	coverProgress: number | null;
	tapMorph: number | null;
	transitionTarget: string | null;
	trackFractionalIndex: number | null;
	committed: boolean | null;
	familySwapScale: number | null;
	settleProgress: number;
	settleActive: boolean;
	settleLatched: HeaderSettleTransition | null;
	settleDirection: 'forward' | 'back';
	settleAwaitTitle: boolean;
	searchScrubbing: boolean;
	replaceStateIntent: boolean;
	set: SetPagerFn;
	setTapMorph: SetTapMorphFn;
	setCommitted: SetCommittedFn;
	setReplaceStateIntent: SetReplaceStateIntentFn;
	setFamilySwapScale: SetFamilySwapScaleFn;
	setSettleState: SetSettleStateFn;
	setSearchScrubbing: SetSearchScrubbingFn;
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
	let committed = $state<boolean | null>(null);
	let familySwapScale = $state<number | null>(null);
	let settleProgress = $state(1);
	let settleActive = $state(false);
	let settleLatched = $state<HeaderSettleTransition | null>(null);
	let settleDirection = $state<'forward' | 'back'>('forward');
	let settleAwaitTitle = $state(false);
	let searchScrubbing = $state(false);
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
		committed = update.committed !== undefined ? update.committed : committed;
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
		// Settle + searchScrubbing state is owned exclusively by the
		// orchestrator's settle / tap-scrub eases (published via
		// setSettleState / setSearchScrubbing). Preserve across pager.set so
		// the per-frame drag publication and resetPagerStore do not clobber
		// an in-flight settle. The orchestrator clears these explicitly via
		// setSettleState / setSearchScrubbing when an ease ends, cancels, or
		// tears down.
		settleProgress = update.settleProgress !== undefined ? update.settleProgress : settleProgress;
		settleActive = update.settleActive !== undefined ? update.settleActive : settleActive;
		settleLatched = update.settleLatched !== undefined ? update.settleLatched : settleLatched;
		settleDirection =
			update.settleDirection !== undefined ? update.settleDirection : settleDirection;
		settleAwaitTitle =
			update.settleAwaitTitle !== undefined ? update.settleAwaitTitle : settleAwaitTitle;
		searchScrubbing =
			update.searchScrubbing !== undefined ? update.searchScrubbing : searchScrubbing;
	}

	function setTapMorph(value: number | null): void {
		tapMorph = value;
	}

	function setCommitted(value: boolean | null): void {
		committed = value;
	}

	function setReplaceStateIntent(value: boolean): void {
		replaceStateIntent = value;
	}

	function setFamilySwapScale(value: number | null): void {
		familySwapScale = value;
	}

	function setSettleState(update: SettleStateUpdate): void {
		if (update.progress !== undefined) settleProgress = update.progress;
		if (update.active !== undefined) settleActive = update.active;
		if (update.latched !== undefined) settleLatched = update.latched;
		if (update.direction !== undefined) settleDirection = update.direction;
		if (update.awaitTitle !== undefined) settleAwaitTitle = update.awaitTitle;
	}

	function setSearchScrubbing(value: boolean): void {
		searchScrubbing = value;
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
		get committed() {
			return committed;
		},
		get familySwapScale() {
			return familySwapScale;
		},
		get settleProgress() {
			return settleProgress;
		},
		get settleActive() {
			return settleActive;
		},
		get settleLatched() {
			return settleLatched;
		},
		get settleDirection() {
			return settleDirection;
		},
		get settleAwaitTitle() {
			return settleAwaitTitle;
		},
		get searchScrubbing() {
			return searchScrubbing;
		},
		get replaceStateIntent() {
			return replaceStateIntent;
		},
		set,
		setTapMorph,
		setCommitted,
		setReplaceStateIntent,
		setFamilySwapScale,
		setSettleState,
		setSearchScrubbing
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
