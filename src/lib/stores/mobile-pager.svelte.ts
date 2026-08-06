/**
 * Pager Store factory - bridges a horizontal pager's drag state to its
 * indicator bar so the indicator tracks the finger live (instead of only
 * snapping on release). The pager is the sole writer; the bar reads.
 *
 * `fractionalIndex` is the active panel plus a fractional drag offset (e.g.
 * 0.5 = halfway from panel 0 to panel 1); at rest it equals the active index.
 * `dragging` is true while a pointer is actively dragging; consumers gate
 * their drag-time behavior on it (the Header morph derivation picks the drag
 * branch; the SearchTabBar stretches its underline). `active` marks that a
 * pager is mounted and driving - until then the bar falls back to the URL so a
 * deep link renders correctly before hydration.
 *
 * `backMorph` drives the Header's layer morph during a swipe-back on a deep /
 * search page. It is the swipe-back progress 0..1 (0 at rest on the current
 * page, 1 once committed toward the source), written frame-synced with
 * `fractionalIndex` by the pipeline orchestrator. At rest: null on tab roots
 * and centerTab routes (thread and compose) so the Header's morph derivation falls back
 * to the at-rest branch (`currentHasTabs ? 1 : 0`, which returns 0 for deep
 * pages via `currentHasTabs === false`). During a drag the orchestrator
 * publishes the live raw drag fraction on centerTab routes (gesture
 * feedback so the morph / layer derivation tracks the live drag and the
 * settle at release interpolates from the captured `startMorph`), on
 * bidirectional tab-host backward-to-non-tab-target (deep page or
 * `/search`) and forward-last-tab-to-`/search` drags, and on every
 * NavPipelineHost drag where the target does not pill-map to a tab
 * (loose `getCurrentTabIndex`; deep page, `/profile`, `/bookmarks`); the
 * only drag-time null publication is a tab-to-tab swipe on a non-centerTab
 * host type (NavPipelineTabHost tab swipes, nulled via the bidirectional
 * `!targetIsDeepPage` clause; AND NavPipelineHost offline LIST routes like
 * `/offline`, `/offline/activity` whose `leftHref` resolves to a tab,
 * nulled via the `(fromIdx >= 0 && toIdx >= 0)` clause), where the
 * morph stays at the static `currentHasTabs ? 1 : 0`. A centerTab route ->
 * tab-root swipe pill-maps both endpoints to a tab but takes the centerTab
 * branch of `#republishToPager`, which publishes `rawDragFraction` end to
 * end as gesture feedback. The Header falls back to a URL-derived default
 * for the null case so a deep link SSRs in the right mode without waiting
 * for hydration.
 *
 * The store carries the per-frame gesture signals the MobileTabBar and the
 * SearchTabBar read, plus the Header morph signals (`tapMorph`,
 * `backMorph`, `transitionTarget`, `scrubIconEndpoint`,
 * `dragging`). The FAB layer reads the orchestrator's publication
 * directly (not these fields). The Header's settle ease state (the
 * post-release / post-title-change crossfade) and the `searchScrubbing`
 * flag live on `NavStateMachine` (private class `$state`); the
 * orchestrator's getters are `$derived` pass-throughs of those fields via
 * its `#publication`, and the Header reads them directly off the
 * orchestrator singleton (see `NavPipelineOrchestrator.settleActive` /
 * `.settleProgress` / `.settleLatched` / `.settleDirection` /
 * `.settleAwaitTitle` / `.searchScrubbing`).
 *
 * Factory: two pagers exist - the PRIMARY pager (NavPipelineTabHost /
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
	/** tap-morph progress 0..1 (DV17): continuous morph signal consumed by
	 * the Header's `iconProgress`, `trackMorph`, and `searchProgress`
	 * derivations on a tap scrub.
	 * null = no tap scrub in flight (rest, drag). Optional so non-publishing
	 * writers compile without touching it. */
	tapMorph?: number | null;
	/** The target pathname of an in-flight pipeline transition (any
	 * centerTab or non-centerTab pipeline slide); null at rest. Read by the
	 * Header's drag-endpoint resolution (the layer guards / back-arrow
	 * reveal), the horizontal-track slide (`trackMorph`), and the search-
	 * axis derivations during the slide. Optional so non-pipeline writers
	 * compile without touching it. */
	transitionTarget?: string | null;
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
type SetScrubIconEndpointFn = (value: number | null) => void;

interface PagerStore extends PagerUpdate {
	targetIndex: number | null;
	tapMorph: number | null;
	transitionTarget: string | null;
	scrubIconEndpoint: number | null;
	replaceStateIntent: boolean;
	set: SetPagerFn;
	setTapMorph: SetTapMorphFn;
	setReplaceStateIntent: SetReplaceStateIntentFn;
	setScrubIconEndpoint: SetScrubIconEndpointFn;
}

export function createPagerStore(): PagerStore {
	let fractionalIndex = $state(0);
	let dragging = $state(false);
	let active = $state(false);
	let backMorph = $state<number | null>(null);
	let targetIndex = $state<number | null>(null);
	let tapMorph = $state<number | null>(null);
	let transitionTarget = $state<string | null>(null);
	let scrubIconEndpoint = $state<number | null>(null);
	let replaceStateIntent = $state(false);

	function set(update: PagerUpdate): void {
		fractionalIndex = update.fractionalIndex;
		dragging = update.dragging;
		active = update.active;
		backMorph = update.backMorph;
		targetIndex = update.targetIndex !== undefined ? update.targetIndex : null;
		transitionTarget = update.transitionTarget ?? null;
		// tapMorph is omitted by the drag $effect's pager.set calls; preserve
		// it so an in-flight tap scrub is not clobbered. The tap publisher
		// writes via setTapMorph.
		tapMorph = update.tapMorph !== undefined ? update.tapMorph : tapMorph;
		// scrubIconEndpoint is owned exclusively by the orchestrator's
		// tap-scrub ease (published via setScrubIconEndpoint). Preserve it
		// across pager.set calls so resetPagerStore and the in-flight drag
		// publications do not clobber a value an in-flight scrub just
		// published. The orchestrator clears the field explicitly via
		// setScrubIconEndpoint(null) when the scrub finishes, cancels, or
		// tears down (unmount, or the tap-scrub finish path
		// `#finishTapScrubEase`). `releaseInputs` intentionally does NOT
		// clear it (the settle / tap-scrub eases continue across the host
		// swap).
		scrubIconEndpoint =
			update.scrubIconEndpoint !== undefined ? update.scrubIconEndpoint : scrubIconEndpoint;
	}

	function setTapMorph(value: number | null): void {
		tapMorph = value;
	}

	function setReplaceStateIntent(value: boolean): void {
		replaceStateIntent = value;
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
		get tapMorph() {
			return tapMorph;
		},
		get transitionTarget() {
			return transitionTarget;
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
