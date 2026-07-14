// src/lib/stores/nav-pipeline-orchestrator.svelte.ts
/**
 * The universal pipeline orchestrator for every mobile route. Owns the
 * four integration points the DV20 spec requires:
 *
 *   1. SvelteKit nav -> orchestrator: `onSvelteKitBeforeNavigate` /
 *      `onSvelteKitAfterNavigate` (called from `src/routes/+layout.svelte`'s
 *      hooks, gated by `isPilotTransition`).
 *   2. Pointer -> intent: `onPointerDown` / `onPointerMove` /
 *      `onPointerUp` (called from the `navPipelinePointer` Svelte
 *      action that wraps `detectSwipe`; a `pointercancel` is routed by
 *      `detectSwipe` through its onUp listener, reaching the
 *      orchestrator as `onPointerUp`).
 *   3. Executor + driver -> elements: `configure({ resolveElements, ... })`
 *      constructs (once) a `LiveNavDomDriver` whose `resolveElements` reads
 *      the host's track `bind:this` plus the FAB / Header via DOM queries;
 *      the executor writes the per-frame visual to those elements.
 *   4. Lifecycle: the host calls `configure` / `releaseInputs` from its
 *      onMount / onDestroy and releases the html-singletons (viewport-lock)
 *      directly with a `browser` guard. The mobile -> desktop flip and app
 *      exit use the full `mount` / `unmount` teardown.
 *
 * Per the DV20 spec's binding "UNIFY, DO NOT BRIDGE" constraint: this
 * orchestrator is the SOLE transition mechanism for EVERY transition
 * type on EVERY mobile route. No `gestureSource` selector; no intent
 * mirror into the host component's `$state`; no CSS-transition +
 * `transitionend` path. Every mobile route mounts `NavPipelineHost` (the
 * thread and deep-page routes) or `NavPipelineTabHost` (the three tab
 * roots); the shared singleton orchestrator drives every transition
 * through the executor's rAF.
 *
 * The orchestrator coordinates; it does NOT bypass SvelteKit (§9).
 * Settle on a commit dispatches the SvelteKit navigation via `goto`
 * (or `history.back()` / `history.forward()` for a hop) - the
 * orchestrator does not own its own navigation API. An internal
 * `navDispatchInFlight` flag lets the orchestrator's own goto re-fire
 * `beforeNavigate` without re-cancelling.
 *
 * Global-singleton pattern: one orchestrator instance is shared by every
 * mobile host for the app's lifetime (see `getGlobalNavPipelineOrchestrator`).
 * The host component (`NavPipelineHost` / `NavPipelineTabHost`) calls
 * `configure(inputs)` on mount and `releaseInputs()` on destroy; a route
 * swap rebinds the element refs in place WITHOUT tearing down the executor
 * + driver + rAF, so the persistent FAB and Header layers (consumers of the
 * orchestrator's publication) read a continuous signal across the swap
 * instead of seeing a per-host lifecycle gap. The mobile -> desktop flip
 * and the app exit call the full `unmount()` teardown.
 *
 * Per DV20 §13.5 the `NavStateMachine` is the sole authority for the
 * macro transition state (phase, plan, FROM/TO, direction). The
 * orchestrator dispatches `intent` / `resolved` / `land` events into
 * the state machine and reads its publication as a `$derived` that
 * merges the state machine's macro fields with the executor's
 * per-frame `#progress`. The orchestrator does not hold an independent
 * publication `$state`.
 */

import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { getMobilePagerStore } from '$lib/stores/mobile-pager.svelte';
import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
import { getNavStateMachine } from '$lib/stores/nav-state-machine.svelte';
import { getNavigationStore } from '$lib/stores/navigation.svelte';
import { atRestOnFor } from '$lib/stores/nav-state-machine-logic';
import { NavExecutor } from '$lib/stores/nav-executor.svelte';
import { progressAtTranslateX, trackTranslateX } from '$lib/utils/nav-executor-logic';
import { LiveNavDomDriver } from '$lib/utils/nav-dom-driver-live';
import { PageLifecycleController } from '$lib/stores/page-lifecycle.svelte';
import {
	DEFAULT_CLASSIFIER_OPTIONS,
	classify,
	initialIntentState,
	type IntentClassifierOptions,
	type IntentEvent,
	type IntentEventKind,
	type IntentState
} from '$lib/utils/nav-intent';
import {
	selectResolver,
	type ResolverInput,
	type TransitionDirection
} from '$lib/utils/nav-resolvers';
import { getRouteData } from '$lib/utils/route-data';
import { getFabRouteAttributes, FAB_KIND_CONFIGS, MOBILE_TABS } from '$lib/utils/route-config';
import { getCurrentTabIndex } from '$lib/utils/route-config';
import { scaleFromFraction, tabFraction, type FabFamily } from '$lib/utils/fab-scale';
import {
	hopForHref,
	isTabRootPath,
	backSwipeShouldPopHistory,
	previousEntryPathname
} from '$lib/utils/history-nav';
import {
	HEADER_MORPH_THRESHOLD,
	PILL_EXPANSION_THRESHOLD,
	SWIPE_COMMIT,
	TRACK_TRANSITION_MS,
	BOUNDARY_RUBBER_BAND_FACTOR,
	TITLE_CROSSFADE_MS
} from '$lib/utils/gesture-constants';
import { resolveDeepHeaderTitle } from '$lib/utils/deep-header-config';
import type { HeaderSettleTransition } from '$lib/utils/header-probe';
import type { TranslationDict } from '$lib/types/translation';
import type { RouteTag } from '$lib/utils/route-data';
import type { TransitionPlan } from '$lib/utils/nav-resolvers';

/** Commit duration for a tab-click exit and a forward-enter. Equals
 *  `TRACK_TRANSITION_MS` (200ms); the easing is the executor's
 *  constant-deceleration `s(u)=2u-u²` (no CSS timing function), so the
 *  slide is the all-rAF ease. Used by `onSvelteKitBeforeNavigate`
 *  (tab-click) and `playEnterAnimation`. Gesture commits use the
 *  velocity-matched solver instead. */
const TAB_CLICK_COMMIT_MS = TRACK_TRANSITION_MS;

/** The host's track / FAB / Header element refs as supplied to the
 *  driver each `write`. Mirrors the structural shape of
 *  `LiveDriverElements` but widened to the production `HTMLElement`
 *  (the driver's own interface accepts a structural `DriverElement`
 *  subset). */
export interface PipelineElementRefs {
	readonly pageTrack: HTMLElement | null;
	readonly fab: HTMLElement | null;
	readonly header: HTMLElement | null;
}

/** Returns the host's track / FAB / Header element refs each
 *  `write`. Called once per frame so a re-bound `bind:this` is picked
 *  up automatically. */
export type PipelineElementResolver = () => PipelineElementRefs;

/** A pending gesture transition (a back-swipe). `to` is the
 *  commit-settle dispatch target; `startProgress` is the track's
 *  progress at gesture start, read by the live-drag loop to continue
 *  from the current visual position (no snap back to 0). */
interface PendingGestureTransition {
	readonly to: string;
	readonly startProgress: number;
	/** The raw drag fraction at gesture start (the commit's last
	 *  published raw for a re-grab, 0 for from-rest). The live-drag's
	 *  coverProgress starts from here so the FAB doesn't jump. */
	readonly rawStart: number;
	/** The gesture's transition direction. 'backward' = rightward
	 *  (toward the previous tab / back-target); 'forward' = leftward
	 *  (toward the next tab, bidirectional hosts only). Determines the
	 *  commit-threshold sign at release. */
	readonly direction: TransitionDirection;
	/** True when the gesture targets an absent neighbour (first/last tab
	 *  on a bidirectional host). The track follows the finger at
	 *  `BOUNDARY_RUBBER_BAND_FACTOR` and always cancels on release (no
	 *  navigation dispatched). */
	readonly boundary: boolean;
}

/** A pending tab-click transition (a host-route -> tab-root nav the
 *  orchestrator cancelled in `onSvelteKitBeforeNavigate`). Carries
 *  the deferred dispatch target (the FULL url: pathname + search) so
 *  commit-settle can fire the SvelteKit `goto` on the exact URL the
 *  tab-click targeted. */
interface PendingTabExit {
	readonly target: string;
}

/** A URL record subset the layout hook extracts from SvelteKit's
 *  navigation event. Defined here so the orchestrator does not depend
 *  on the SvelteKit navigation type directly. */
interface PilotNavUrl {
	readonly pathname: string;
	readonly search: string;
}

/** A `from`/`to` endpoint carried by `PilotBeforeNavigateEvent`. */
interface PilotNavEndpoint {
	readonly url: PilotNavUrl;
}

/** SvelteKit's navigation-cancel hook. */
export type PilotCancelFn = () => void;

/** The subset of the SvelteKit `BeforeNavigate` event the orchestrator
 *  reads. Defined here so the orchestrator does not depend on the
 *  SvelteKit navigation type directly (the layout hook adapts). */
interface PilotBeforeNavigateEvent {
	readonly from: PilotNavEndpoint | null;
	readonly to: PilotNavEndpoint | null;
	readonly type: string;
	readonly cancel: PilotCancelFn;
}

/** The current viewport width (px). The host reads `window.innerWidth` /
 *  the bound element's `clientWidth` and supplies it; the orchestrator
 *  does not read the DOM directly. */
export interface PipelineMountInputs {
	/** Returns the host's track / FAB / Header element refs each
	 *  `write`. Called once per frame so a re-bound `bind:this` is
	 *  picked up automatically. */
	readonly resolveElements: PipelineElementResolver;
	/** The current viewport width (px). */
	readonly viewportWidth: number;
	/** The multi-panel track's resting translate (px) at progress=0.
	 *  For a 2-panel host (`NavPipelineHost`) this is `-viewportWidth`
	 *  so the centre panel (the right half of the 2*W track) fills the
	 *  viewport and the left panel sits off-screen. For a 3-panel
	 *  bidirectional host (`NavPipelineTabHost`) this is
	 *  `-activeIndex * viewportWidth`. The plan's
	 *  `pageTrack.restingTranslate` field carries this into the
	 *  executor's `buildVisual`. */
	readonly restingTranslate: number;
	/** The host route's back-target (the `leftHref` prop on
	 *  `NavPipelineHost`, resolved host-side to the actual URL). */
	readonly backTarget: string;
	/** The current route's pathname. */
	readonly fromPathname: string;
	/** The current route's tag. */
	readonly fromTag: RouteTag;
	/** The back-target's tag. */
	readonly toTag: RouteTag;
	/** The tab-bar pill index the FROM route is associated with; -1
	 *  when FROM has no tab association. The thread host passes its
	 *  `centerTab` here so the pill animates from the thread's tab. */
	readonly fromTabIndex: number;
	/** Index of the back-target in the tab-bar's pill order, or -1
	 *  when TO is not a tab root. */
	readonly toTabIndex: number;
	/** The thread host's `centerTab` prop (the tab index the thread
	 *  page is centered on, e.g. 0 for discussions). When set, the
	 *  orchestrator publishes `backMorph: null, targetIndex: null,
	 *  fractionalIndex: centerTab` (constant) to the pager store so
	 *  the Header stays in back-arrow mode and the pill stays on the
	 *  thread's tab throughout the gesture. When undefined, the
	 *  morph/pill values apply (deep page or tab host). */
	readonly centerTab?: number;
	/** When true the orchestrator claims BOTH rightward and leftward
	 *  drags (`NavPipelineTabHost`, the three tab roots). Rightward
	 *  targets the back-target (previous tab); leftward targets the
	 *  next tab. When false or undefined, only rightward back-swipes
	 *  are claimed (`NavPipelineHost`, the thread and deep-page
	 *  routes). */
	readonly bidirectional?: boolean;
}

/** The orchestrator's published reactive state for downstream
 *  consumers (the host's `$effect` reads this and publishes to the
 *  pager store so the existing FAB / Header layers react). Per DV20
 *  §13.5 the NavStateMachine is the sole authority for the macro
 *  fields (plan, FROM/TO, direction, in-flight) and the settle +
 *  tap-scrub micro animation state; only `progress` is the executor's
 *  per-frame contribution. */
export interface OrchestratorPublication {
	/** Null when at-rest; the resolved plan when transitioning. */
	readonly plan: TransitionPlan | null;
	/** The current gesture progress in [0, 1]. */
	readonly progress: number;
	/** True when a transition is in flight. */
	readonly inFlight: boolean;
	/** The resolved FROM pathname. */
	readonly fromPathname: string | null;
	/** The resolved TO pathname. */
	readonly toPathname: string | null;
	/** The transition direction. */
	readonly direction: TransitionDirection | null;
	/** True while the settle ease owns the morph / title crossfade. */
	readonly settleActive: boolean;
	/** The eased settle progress 0..1. */
	readonly settleProgress: number;
	/** The latched endpoint identity of the in-flight settle. null at rest. */
	readonly settleLatched: HeaderSettleTransition | null;
	/** The direction of the in-flight settle (forward / back). */
	readonly settleDirection: 'forward' | 'back';
	/** True while a commit settle holds at progress 1 awaiting the
	 *  navigation to land. */
	readonly settleAwaitTitle: boolean;
	/** True while the tap-scrub ease is in flight. */
	readonly searchScrubbing: boolean;
}

/** The clock function the intent classifier + executor use. */
type ClockFn = () => number;

function defaultClock(): number {
	if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
		return performance.now();
	}
	return Date.now();
}

/** The pipeline orchestrator. A single global instance is shared by
 *  every mobile host (see `getGlobalNavPipelineOrchestrator`); hosts
 *  call `configure` on mount and `releaseInputs` on destroy so the
 *  executor + driver + rAF persist across route swaps. Holds the
 *  NavStateMachine, NavExecutor, LiveNavDomDriver, the intent
 *  classifier state, and the lifecycle controller. */
export class NavPipelineOrchestrator {
	#stateMachine = getNavStateMachine();
	#executor: NavExecutor | null = null;
	#driver: LiveNavDomDriver | null = null;
	readonly #lifecycle = new PageLifecycleController(browser);
	#intent: IntentState = initialIntentState();
	#classifierOpts: IntentClassifierOptions = DEFAULT_CLASSIFIER_OPTIONS;
	readonly #clock: ClockFn;
	#mountInputs: PipelineMountInputs | null = null;
	// The host's element resolver, captured on each `configure`. The
	// driver is constructed once with a stable closure that reads
	// through this field, so a `configure` rebind (a route swap that
	// supplies fresh `bind:this` refs) takes effect on the next frame
	// without reconstructing the driver.
	#elementResolver: PipelineElementResolver = () => ({
		pageTrack: null,
		fab: null,
		header: null
	});
	// True between configure() and releaseInputs(). Guards #publication
	// so the derived returns at-rest during the gap frame between an old
	// host's releaseInputs and the new host's configure, instead of
	// publishing the prior route's transition state to the persistent
	// FAB / Header consumers.
	#mounted = $state(false);
	/** A pending back-swipe gesture. `to` is the commit-settle dispatch
	 *  target; `startProgress` is the track's progress at gesture start,
	 *  read by the live-drag loop. Null at rest and after settle. */
	#pendingGesture: PendingGestureTransition | null = null;
	/** A pending tab-click transition. The orchestrator cancelled the
	 *  SvelteKit nav; `target` is the dispatch target fired on
	 *  commit-settle. Null at rest. */
	#pendingTabExit: PendingTabExit | null = null;
	/** A queued discrete navigation (tab-click) that arrived while a
	 *  commit slide was in flight. The orchestrator accelerated the
	 *  in-flight commit to completion; when the commit settles,
	 *  dispatches its own nav, and the nav lands, `#landAtRest` fires
	 *  this queued goto so `onSvelteKitBeforeNavigate` intercepts it on
	 *  the landed host and plays the tab-click transition from progress
	 *  0 (the finish-then-new interruption policy). Null when no
	 *  discrete nav is queued. */
	#queuedDiscreteNav: PendingTabExit | null = null;
	/** True while the forward-enter animation (playEnterAnimation) is
	 *  active. The afterNavigate guard and the resize guard read it to
	 *  avoid landing the orchestrator or mutating the plan mid-enter. */
	#isEnterAnimation = false;
	/** True while a rightward back-swipe gesture is in its live-drag
	 *  phase. The classifier locks `micro='drag-right'` once the gesture
	 *  is claimed, so a mid-gesture reversal (finger moves leftward
	 *  within the claimed gesture) stays live-dragging; the flag clears
	 *  on release (committed / cancelled). Controls the pager store's
	 *  `dragging` field: true during live drag only, NOT during the
	 *  commit slide (dragOffset is nulled on release). */
	#liveDragging = false;
	/** True when the orchestrator's own dispatch (`goto` /
	 *  `history.back()` / `history.forward()`) has fired and is
	 *  re-entering beforeNavigate. Lets the orchestrator's
	 *  beforeNavigate handler pass it through. */
	#navDispatchInFlight = $state(false);
	/** The most recent dispatch's target URL (pathname + search). The robust
	 *  pass-through check in `onSvelteKitBeforeNavigate`: matching
	 *  the nav's `to` against the dispatched target catches the
	 *  orchestrator's own `goto` / `history.back()` re-entry
	 *  regardless of timer or popstate ordering. */
	#dispatchTarget: string | null = null;
	/** The executor-driven per-frame raw drag fraction in [0, 1]. The
	 *  state machine owns the macro authority (phase, plan, FROM/TO,
	 *  direction); this field owns the sub-frame progress the executor
	 *  produces each tick. The `#publication` derived merges the two. */
	#progress = $state(0);
	/** Reactive publication: a read-through to the state machine's macro
	 *  state (plan, FROM/TO, direction, in-flight phase) and settle +
	 *  tap-scrub micro state, merged with the executor-driven `#progress`.
	 *  Per DV20 §13.5 the state machine is the sole authority; this
	 *  derived has no independent state. */
	readonly #publication = $derived.by<OrchestratorPublication>(() => {
		// Guard: between releaseInputs (old host destroy) and configure
		// (new host mount), #mountInputs is null and #mounted is false.
		// Return at-rest for the gap frame so this derived does not
		// publish the prior host's transition state to the persistent
		// FAB / Header consumers.
		if (!this.#mounted) {
			return {
				plan: null,
				progress: 0,
				inFlight: false,
				fromPathname: null,
				toPathname: null,
				direction: null,
				settleActive: this.#stateMachine.settleActive,
				settleProgress: this.#stateMachine.settleProgress,
				settleLatched: this.#stateMachine.settleLatched,
				settleDirection: this.#stateMachine.settleDirection,
				settleAwaitTitle: this.#stateMachine.settleAwaitTitle,
				searchScrubbing: this.#stateMachine.searchScrubbing
			};
		}
		const sm = this.#stateMachine.state;
		return {
			plan: sm.macro.plan,
			progress: this.#progress,
			inFlight: sm.macro.kind === 'transitioning',
			fromPathname: sm.fromPathname,
			toPathname: sm.toPathname,
			direction: sm.direction,
			settleActive: this.#stateMachine.settleActive,
			settleProgress: this.#stateMachine.settleProgress,
			settleLatched: this.#stateMachine.settleLatched,
			settleDirection: this.#stateMachine.settleDirection,
			settleAwaitTitle: this.#stateMachine.settleAwaitTitle,
			searchScrubbing: this.#stateMachine.searchScrubbing
		};
	});
	/** The raw drag-fraction published at the moment a commit / cancel
	 *  began. The commit-phase publication lerps from this value to the
	 *  target (1 commit / 0 cancel) along the executor's eased fraction,
	 *  so `coverProgress` stays continuous across the
	 *  drag-to-commit boundary for every transition that starts a
	 *  commit/cancel (gesture from rest, mid-transition interrupt,
	 *  tab-click / enter with no live drag). A sub-threshold cancel
	 *  lands at rest immediately and bypasses this. */
	#commitStartRaw = 0;
	/** True iff the previous #interpretIntent call was for a rightward
	 *  drag (micro === drag-right). Used to detect a gesture start
	 *  (micro transitions into drag-right), including a re-grab
	 *  mid-commit. */
	#prevWasDrag = false;
	/** The gesture-resolved destination tab index, set by
	 *  `#beginGesture` / `onSvelteKitBeforeNavigate` and read by
	 *  `#republishToPager` so the pill interpolation follows the actual
	 *  destination, not the at-rest `mountInputs.toTabIndex`. Cleared on
	 *  land / unmount. */
	#gestureToTabIndex: number | null = null;
	/** The rAF handle for the route-swap family-change ease. The
	 *  orchestrator owns the FAB family-swap motion on this rAF (a
	 *  distinct loop from the executor's gesture rAF, which is
	 *  gesture-only). Started by `configure` on a real family change,
	 *  cancelled on completion, on a higher-priority driver taking over
	 *  (live drag / pipeline transition to a list family), and on
	 *  `releaseInputs` / `unmount`. */
	#familySwapRafId: number | undefined;
	/** The eased family-swap scale's starting value (the FAB's
	 *  pre-swap rendered scale, captured before the route swap). */
	#familySwapFromScale = 0;
	/** The eased family-swap scale's target (the destination family's
	 *  resting scale, captured on the first tick once the new
	 *  mountInputs have settled). */
	#familySwapToScale = 0;
	/** True after the first tick has captured `#familySwapToScale`. The
	 *  clock starts on that first tick so the full TRACK_TRANSITION_MS
	 *  curve plays regardless of the gap between `configure` arming the
	 *  ease and the first rAF. */
	#familySwapToScaleCaptured = false;
	/** The wall-clock start time of the ease (set on the first tick). */
	#familySwapStartTs = 0;
	/** The last FAB scale value the orchestrator published (either the
	 *  eased value while a family-swap ease runs, or the resting-scale
	 *  projection of the orchestrator's published coverProgress /
	 *  trackFractionalIndex / fractionalIndex at the end of every
	 *  `#republishToPager`). Read by `configure` to anchor the next
	 *  family-swap ease at the visible pre-swap scale, immune to the
	 *  reactive race where the destination route's at-rest publication
	 *  snaps the FAB to the new family's resting scale before the ease's
	 *  first tick. Survives `releaseInputs` (the route-swap gap between
	 *  a host's destroy and the next host's configure) since the
	 *  orchestrator singleton persists. */
	#lastRenderedScale = 0;
	/** The FAB family of the route the orchestrator was last configured
	 *  for. Compared on each `configure` to detect a route-swap family
	 *  change (the trigger for the family-swap ease). Null before the
	 *  first configure so the initial mount skips the ease. */
	#previousFamily: FabFamily | null = null;
	/** The foregroundFraction seed captured when a gesture's
	 *  `#cancelAllAnimationEases` interrupts a running family-swap ease.
	 *  Inverted from the eased scale via `seedFraction = (easedScale + 1) /
	 *  2` (the inverse of `scaleFromFraction(f) = clamp(2f - 1, 0, 1)`).
	 *  While non-null, `#republishToPager` publishes a SEEDED
	 *  `coverProgress = seed + (1 - seed) * rawDragFraction` so the FAB
	 *  scales continuously from the eased value (at rawDragFraction 0) up
	 *  to 1 (at rawDragFraction 1) as the slide reveals the destination.
	 *  `pager.familySwapScale` is cleared at capture time so the FAB reads
	 *  its resting formula over the seeded foregroundFraction.
	 *  `#lastRenderedScale` stays in sync with the visible scale via the
	 *  seeded publication. `#landAtRest` (cancel case) re-arms the
	 *  family-swap ease from `#lastRenderedScale`; `releaseInputs` (commit
	 *  case) captures `#lastRenderedScale` for the next configure's ease
	 *  anchor. Both clear the seed. */
	#fabDragSeedFraction: number | null = null;

	// ---------------------------------------------------------------------
	// Settle ease state. The orchestrator owns the Header's post-release /
	// post-title-change crossfade. The rAF below eases the settle progress
	// toward `#settleTargetProgress` over TITLE_CROSSFADE_MS with the
	// constant-deceleration curve `s(u) = 2u - u²` (the same curve the
	// executor's commit loop and the tap-scrub ease use). Each tick writes
	// the eased progress to the state machine (the §13.5 authority); the
	// Header reads it via the orchestrator's publication. Reduced-motion
	// snaps (no rAF integration).
	#settleRafId: number | undefined;
	/** The eased settle progress's start value (the release position for a
	 *  gesture-release settle, 0 for a non-gesture title-change settle). */
	#settleStartProgress = 0;
	/** The eased settle progress's terminal value (1 for commit / click, 0
	 *  for cancel). */
	#settleTargetProgress: 0 | 1 = 1;
	/** Wall-clock start time of the ease (set on the first tick). */
	#settleStartTs = 0;
	/** True while a commit settle holds at progress 1 awaiting the
	 *  navigation to land. The afterNavigate hook + the title-change
	 *  watcher clear it; on clear, an in-flight rAF endSettles at u=1 on
	 *  its tick (no premature morph snap), a completed rAF endSettles
	 *  immediately. Internal bookkeeping: the reactive publication of
	 *  this flag lives on the state machine (`settleAwaitTitle`). */
	#settleAwaitTitle = false;

	// ---------------------------------------------------------------------
	// tap-scrub ease state. The orchestrator owns the root<->search
	// horizontal-track scrub on a tap navigation. The rAF below eases
	// `pager.tapMorph` from `#scrubFromValue` to `#scrubToValue` over
	// TITLE_CROSSFADE_MS with the constant-deceleration curve the settle
	// ease uses, frame-synced with the NavPipelineHost Page panel the
	// executor drives. Reduced-motion snaps.
	#tapScrubRafId: number | undefined;
	/** The scrub's start value (1 for an exit-from-root, 0 for an
	 *  enter-from-search). */
	#scrubFromValue = 0;
	/** The scrub's terminal value (0 for exit-to-search, 1 for
	 *  enter-to-root). */
	#scrubToValue = 0;
	/** Wall-clock start time of the scrub ease. */
	#scrubStartTs = 0;
	/** The pathname the scrub started on. The clear watch clears tapMorph
	 *  when the route leaves it (mid-scrub redirect recovery). */
	#scrubSource = '';
	/** Whether the scrub's destination route has tabs (true = a tab root).
	 *  The clear watch clears tapMorph when currentHasTabs === scrubTarget
	 *  AND the eased value reached its terminal (the scrub completed at
	 *  the destination). */
	#scrubTargetTabs = false;
	/** The scrub's terminal value (mirrors `#scrubToValue` for the clear
	 *  watch's at-terminal check). */
	#scrubTerminal = 0;

	// ---------------------------------------------------------------------
	// Header-state tracking + detection. The orchestrator owns the
	// detection logic for the non-gesture settle arm (a title change) and
	// the root<->search tap-scrub arm. The trigger signals come from two
	// sources: a gesture release is armed directly from
	// `#interpretIntent` (the orchestrator is the gesture authority); a
	// non-gesture title change or a root<->search flip is fed by the
	// Header's `$effect.pre` notification via `notifyHeaderState` (the
	// Header is in a component scope so SvelteKit's `$app/state` `page`
	// reactivity reaches it; the orchestrator singleton module does not).
	#headerStateInitialized = false;
	#prevHeaderTitle = '';
	#prevHeaderHasTabs = false;
	#prevHeaderIsSearch = false;
	/** The live translation dict, fed by the Header's `notifyHeaderState`
	 *  each time the route changes. The orchestrator does not see SvelteKit's
	 *  `$app/state` `page.data.t` reactivity from its singleton module scope;
	 *  the Header (in a component scope) does. Kept current so the
	 *  gesture-release settle arming can resolve the back-target title via
	 *  `resolveDeepHeaderTitle`. */
	#headerT: TranslationDict | null = null;
	/** True when the current in-flight navigation was dispatched by the
	 *  orchestrator (a gesture commit or a tab-click commit). Set at
	 *  dispatch time in `#dispatchNav` (BEFORE the navigation lands) so
	 *  the Header's `notifyHeaderState` `$effect.pre` - which fires
	 *  BEFORE `afterNavigate` - reads the CURRENT navigation's flag (a
	 *  flag set at land time would be stale at header-notification time).
	 *  Read in `notifyHeaderState` so the tap-scrub arming can skip the
	 *  just-landed pipeline commit (the executor's slide already drove
	 *  the search-layout visual to its post-land position; arming a
	 *  fresh scrub would re-animate it from the opposite endpoint and
	 *  jump). Cleared in `#landAtRest` (the navigation has landed) and
	 *  in `notifyHeaderState` (defensive clear after the read so a
	 *  second header-state notification within the same navigation does
	 *  not re-consume the flag). */
	#lastLandWasPipelineCommit = false;

	constructor(clock: ClockFn = defaultClock) {
		this.#clock = clock;
	}

	/** Reactive publication for downstream consumers. The host reads
	 *  this in a `$effect` and writes the pager store so the FAB
	 *  layer (Family B reader of `coverProgress`) and the Header
	 *  layer (reader of `backMorph`) react to the orchestrator's
	 *  state. */
	get publication(): OrchestratorPublication {
		return this.#publication;
	}

	/** Reactive read of the in-flight flag. */
	get inFlight(): boolean {
		return this.#publication.inFlight;
	}

	/** Reactive read of the active plan. */
	get activePlan(): TransitionPlan | null {
		return this.#publication.plan;
	}

	/** Reactive read of the in-flight settle flag. The Header reads this
	 *  to select the morph / titleView settle branch. Delegates to the
	 *  state machine (the §13.5 authority) via the publication. */
	get settleActive(): boolean {
		return this.#publication.settleActive;
	}
	/** Reactive read of the eased settle progress. Delegates to the
	 *  state machine via the publication. */
	get settleProgress(): number {
		return this.#publication.settleProgress;
	}
	/** Reactive read of the latched settle record. Delegates to the
	 *  state machine via the publication. */
	get settleLatched(): HeaderSettleTransition | null {
		return this.#publication.settleLatched;
	}
	/** Reactive read of the settle direction. Delegates to the state
	 *  machine via the publication. */
	get settleDirection(): 'forward' | 'back' {
		return this.#publication.settleDirection;
	}
	/** Reactive read of the awaitTitle flag (DEV probe consumer).
	 *  Delegates to the state machine via the publication. */
	get settleAwaitTitle(): boolean {
		return this.#publication.settleAwaitTitle;
	}
	/** Reactive read of the search-scrub gate flag. The Header reads this
	 *  to freeze the hamburger icon during a tap scrub. Delegates to the
	 *  state machine via the publication. */
	get searchScrubbing(): boolean {
		return this.#publication.searchScrubbing;
	}

	/** Configure: capture the host's mount inputs, rebind the element
	 *  resolver, forceReset the shared state machine to at-rest on this
	 *  route's tag, reset the publication, and run the lifecycle
	 *  `activate`. Construct-once: the executor + driver + lifecycle
	 *  `mount` are built on the first configure and reused across every
	 *  subsequent configure; only the per-host inputs + element-resolver
	 *  are rebound. The route-swap pairing is `releaseInputs` (old host)
	 *  -> `configure` (new host) on the same singleton; no rAF is
	 *  cancelled and no lifecycle `unmount` runs between them, so the
	 *  persistent FAB / Header layers see a continuous signal. */
	configure(inputs: PipelineMountInputs): void {
		this.#mountInputs = inputs;
		this.#elementResolver = inputs.resolveElements;
		// Construct-once. The driver is built with a stable closure that
		// reads through `#elementResolver`, so a re-configure (a route
		// swap with fresh `bind:this` refs) takes effect on the next
		// `write` without reconstructing the driver or the executor.
		if (this.#driver === null) {
			this.#driver = new LiveNavDomDriver({
				resolveElements: () => this.#elementResolver()
			});
		}
		if (this.#executor === null) {
			this.#executor = new NavExecutor({
				driver: this.#driver,
				now: this.#clock,
				onSettle: (progressDirection) => this.#onExecutorSettle(progressDirection),
				onTick: (progress) => this.#onExecutorTick(progress)
			});
		}
		// Reset the state machine (the singleton authority) to at-rest on
		// this route's tag so a stale phase from the prior host does not
		// leak into the derived publication. The `forceReset` bypasses
		// the `reset` event's `intent` guard: the singleton may be in
		// any phase when the next host configures.
		this.#stateMachine.forceReset(atRestOnFor(inputs.fromTag));
		this.#progress = 0;
		// Publish the at-rest pager state now that #mountInputs is set,
		// independent of the host reset $effect's timing.
		this.resetPagerStore();
		// Detect a route-swap family change (the trigger for the family-swap
		// ease). Computed AFTER #mountInputs + resetPagerStore so the new
		// family is resolved against the destination route's pathname and
		// the pager store reflects the at-rest publication the FAB layer
		// reads. Skipped on the first configure (#previousFamily === null).
		this.#detectFamilyChange(inputs.fromPathname);
		this.#mounted = true;
		this.#lifecycle.activate();
	}

	/** Mount: configure the inputs and run the one-time lifecycle
	 *  `mount` (SSR + hydrate done). Used for the initial setup or after
	 *  a full `unmount` (mobile -> desktop flip); route swaps call
	 *  `configure` directly so the executor + driver persist across the
	 *  swap. The lifecycle `mount` is idempotent so a re-mount after a
	 *  desktop -> mobile flip (which calls `unmount` then `mount`) is
	 *  safe. */
	mount(inputs: PipelineMountInputs): void {
		this.configure(inputs);
		this.#lifecycle.mount();
	}

	/** Release the host's inputs and run the lifecycle `deactivate`. The
	 *  singleton's executor + driver + rAF + lifecycle `mount` persist
	 *  for the next host's `configure`; this is the route-swap teardown
	 *  path. The gap-frame publication reads at-rest because
	 *  `#mountInputs` becomes null and `#mounted` becomes false (the
	 *  guard in `#publication`). */
	releaseInputs(): void {
		// Capture the FAB's current scale before clearing the inputs so the
		// next configure's family-swap ease anchors at the visible pre-swap
		// scale (the orchestrator is the sole owner of this tracking).
		// During a seeded drag (a gesture that interrupted a family-swap
		// ease), `#lastRenderedScale` is kept in sync with the visible scale
		// by the seeded publication in `#republishToPager`, so the resting
		// formula re-derives the same value here. Skipped while a
		// (non-interrupted) family-swap ease runs (its tick maintains
		// #lastRenderedScale at the eased value, which IS the visible scale).
		if (this.#familySwapRafId === undefined) {
			this.#lastRenderedScale = this.#computeFabRestingScale();
		}
		this.#fabDragSeedFraction = null;
		this.#mountInputs = null;
		this.#mounted = false;
		this.#pendingGesture = null;
		this.#pendingTabExit = null;
		this.#navDispatchInFlight = false;
		this.#dispatchTarget = null;
		this.#gestureToTabIndex = null;
		// Cancel the family-swap ease: the route swap that releaseInputs
		// tears down for is either the source of the family change (the
		// new host's configure will re-arm a fresh ease anchored at
		// #lastRenderedScale) or a route-away (no further FAB motion
		// needed). #lastRenderedScale + #previousFamily survive so the
		// next configure can detect the change.
		this.#stopFamilySwapEase();
		// Do NOT cancel the settle / tap-scrub eases here: the Header
		// persists across the route swap, and a settle in flight at the
		// host's destroy (a commit settle awaiting its navigation landing)
		// must continue until the navigation lands. `notifyHeaderState`'s
		// `!this.#mounted` guard skips re-arming during the gap frame
		// (releaseInputs -> the next configure) AND on a mobile -> desktop
		// flip (unmount); the afterNavigate hook clears the awaitTitle
		// once the navigation lands.
		// Clear the in-flight pager state so a stale fractionalIndex /
		// transitionTarget does not drive the FAB on the destination
		// route before that route's configure publishes its own state.
		getMobilePagerStore().set({
			fractionalIndex: 0,
			dragging: false,
			active: false,
			backMorph: null,
			targetIndex: null,
			coverProgress: 0,
			transitionTarget: null,
			committed: null
		});
		getMobilePagerStore().setReplaceStateIntent(false);
		this.#lifecycle.deactivate();
	}

	/** Update the viewport dimensions on a host resize. The
	 *  orchestrator captures `viewportWidth` / `restingTranslate` once
	 *  at mount; on a viewport resize (e.g. desktop -> mobile, or
	 *  browser resize) the host's ResizeObserver detects the new
	 *  width and calls this so subsequent plan resolutions and
	 *  drag-fraction computations use the live width. A transition
	 *  that is already in flight keeps its locked plan (the slide
	 *  continues to its settled translateX); only the NEXT transition
	 *  picks up the new width. */
	updateViewport(viewportWidth: number, restingTranslate: number): void {
		const current = this.#mountInputs;
		if (current === null) return;
		// Do not mutate the viewport during an in-flight transition: the
		// locked plan's geometry (distance, restingTranslate) uses the
		// gesture-start width; mutating viewportWidth mid-drag would
		// desync the rawDragFraction (new width) from the locked plan
		// (old width). The next transition picks up the new width.
		// Also guards the forward-enter animation (#isEnterAnimation drives
		// the executor rAF without setting either pending slot).
		if (this.#pendingGesture !== null || this.#pendingTabExit !== null || this.#isEnterAnimation)
			return;
		this.#mountInputs = {
			...current,
			viewportWidth,
			restingTranslate
		};
	}

	/** Play a forward enter-slide animation (left panel -> centre
	 *  panel). Called synchronously from the host's `onMount` (the DOM
	 *  is mounted so `viewportEl.clientWidth` is available) when the
	 *  route is reached via a forward SPA navigation from the backTarget.
	 *  The track starts at `translateX(0)` (left panel visible) and
	 *  slides to `translateX(-W)` (centre visible) over ~200ms via
	 *  the executor's rAF. The easing is the executor's constant-deceleration
	 *  `s(u) = 2u - u²` (Plan §5). No
	 *  navigation is dispatched on settle (the route has already landed). */
	playEnterAnimation(): void {
		const inputs = this.#mountInputs;
		const executor = this.#executor;
		if (inputs === null || executor === null) return;
		const w = inputs.viewportWidth;
		if (w <= 0) return;
		// Defensive: if a gesture or tab-click somehow reached the
		// orchestrator between mount and this synchronous call (only
		// reachable if a beforeNavigate fires during mount), it owns the
		// host now: skip the enter so the in-flight transition is not
		// clobbered.
		if (this.#pendingGesture !== null || this.#pendingTabExit !== null) return;
		const plan: TransitionPlan = {
			pageTrack: {
				axis: 'left',
				distance: w,
				restingTranslate: 0
			},
			// During the enter, coverProgress ramps 0 to 1 (the executor's
			// commit rAF publishes it); the FAB layer's foregroundFraction
			// gate hides the FAB (the destination is a non-list family). The
			// centerTab branch's backMorph = null drives the Header.
			progressDirection: 0,
			commitPhysics: this.#driver?.prefersReducedMotion() ? 'snap' : 'momentum'
		};
		this.#pendingGesture = null;
		this.#pendingTabExit = null;
		// Capture the in-flight raw BEFORE resetting the progress
		// (consistent with #beginGesture / onSvelteKitBeforeNavigate).
		// playEnterAnimation runs synchronously after configure in the
		// host's onMount, so the prior progress is 0 (configure reset it).
		this.#commitStartRaw = this.#progress;
		this.#isEnterAnimation = true;
		// The enter is a forward transition: FROM is the back-target, TO
		// is the host route. Dispatch through the state machine so its
		// macro state (phase, plan, FROM/TO, direction) is the authority
		// the derived publication reads.
		const enterIntent: IntentState = {
			...initialIntentState(),
			micro: 'committed',
			target: inputs.fromPathname,
			startedAt: this.#clock()
		};
		const toData = getRouteData(inputs.fromPathname);
		this.#stateMachine.onIntent(enterIntent, inputs.backTarget, inputs.toTag);
		this.#stateMachine.onResolved(
			plan,
			inputs.backTarget,
			inputs.fromPathname,
			inputs.toTag,
			toData.tag,
			'forward'
		);
		this.#progress = 0;
		// The enter starts at rest (progress 0). playEnterAnimation runs
		// synchronously after configure in the host's onMount; the guard
		// above returns if a gesture or tab-click arrived in the same
		// tick, so there is no in-flight position to continue from.
		const startProgress = this.#startProgressFromCurrentVisual(plan);
		executor.onDragStart(plan, startProgress, 0);
		executor.onCommit(0, TAB_CLICK_COMMIT_MS);
		this.#stateMachine.onCommit();
	}

	/** Land an in-flight COMMIT transition when the platform flips mobile ->
	 *  desktop (called by the host's resize handler, NOT by a route-away
	 *  releaseInputs). A commit-slide (progressDirection=0) in flight when the
	 *  viewport crosses the desktop breakpoint still lands on its target via
	 *  a viewport-flip handler (the mobile->desktop analogue of the
	 *  commit-settle dispatch, not a setTimeout-backed poll). A pre-commit live-
	 *  drag (executor still in the 'live' phase) and a cancel-slide
	 *  (progressDirection=1) do NOT land - the user may still cancel, or
	 *  already cancelled. A route-away releaseInputs (onDestroy) does not call
	 *  this, so the user's fresh navigation wins. */
	recoverDesktopFlipNav(): void {
		if (this.#executor?.state.phase !== 'committing') return;
		// Only a commit (progressDirection=0) should land on its target;
		// a cancel (progressDirection=1, delegated to onCommit via onCancel)
		// snaps back to FROM - dispatching the back-target on a cancel would
		// navigate the user to a destination they explicitly cancelled.
		if (this.#executor?.activePlan?.progressDirection !== 0) return;
		const target = this.#pendingTabExit?.target ?? this.#pendingGesture?.to;
		if (target !== undefined && !this.#navDispatchInFlight) {
			this.#dispatchNav(target);
		}
	}

	/** Unmount: full teardown. Stops the rAF, drops the plan + executor +
	 *  driver, and runs the lifecycle `unmount`. Used for the mobile ->
	 *  desktop flip (the host stays mounted but the gesture surface
	 *  leaves the mobile breakpoint) and the app exit. Route swaps do
	 *  NOT call this; they call `releaseInputs` so the singleton's
	 *  executor + driver persist for the next host's `configure`.
	 *  Idempotent. */
	unmount(): void {
		this.#executor?.stop();
		this.#executor = null;
		this.#driver = null;
		this.#pendingGesture = null;
		this.#pendingTabExit = null;
		this.#queuedDiscreteNav = null;
		this.#navDispatchInFlight = false;
		this.#dispatchTarget = null;
		this.#intent = initialIntentState();
		this.#progress = 0;
		// Reset every transient transition field so the next mount (a
		// desktop -> mobile flip that re-enters mobile) starts clean.
		this.#isEnterAnimation = false;
		this.#commitStartRaw = 0;
		this.#liveDragging = false;
		this.#prevWasDrag = false;
		this.#gestureToTabIndex = null;
		// Tear down the family-swap ease + the family-tracking fields so
		// the next mount (a desktop -> mobile flip re-entering mobile)
		// sees no stale ease and treats its first configure as a
		// first-mount (#previousFamily === null -> skip the ease).
		this.#stopFamilySwapEase();
		this.#familySwapFromScale = 0;
		this.#familySwapToScale = 0;
		this.#familySwapToScaleCaptured = false;
		this.#familySwapStartTs = 0;
		this.#lastRenderedScale = 0;
		this.#previousFamily = null;
		this.#fabDragSeedFraction = null;
		// Tear down the settle + tap-scrub eases and the header-state
		// watchers so the next mount (a desktop -> mobile flip) starts
		// clean. The first configure after the re-mount re-installs the
		// watchers.
		this.#cancelSettleEaseRaf();
		this.#cancelTapScrubRaf();
		this.#stateMachine.setSettleState({ active: false });
		this.#settleAwaitTitle = false;
		this.#settleStartProgress = 0;
		this.#settleStartTs = 0;
		this.#scrubSource = '';
		this.#scrubFromValue = 0;
		this.#scrubToValue = 0;
		this.#scrubStartTs = 0;
		this.#scrubTerminal = 0;
		this.#headerStateInitialized = false;
		this.#prevHeaderTitle = '';
		this.#prevHeaderHasTabs = false;
		this.#prevHeaderIsSearch = false;
		this.#headerT = null;
		this.#lastLandWasPipelineCommit = false;
		this.#mountInputs = null;
		this.#mounted = false;
		this.#lifecycle.deactivate();
		this.#lifecycle.unmount();
		// Clear the in-flight pager state so a stale fractionalIndex /
		// transitionTarget does not drive the FAB on the destination route
		// before that route publishes its own state (mirrors the at-rest
		// pager publication each host sets on configure).
		getMobilePagerStore().set({
			fractionalIndex: 0,
			dragging: false,
			active: false,
			backMorph: null,
			targetIndex: null,
			coverProgress: 0,
			transitionTarget: null,
			committed: null
		});
		// Clear the settle / tap-scrub publications so the next mount
		// starts at rest. The state machine owns these (§13.5); the
		// Header reads via the orchestrator's publication.
		this.#stateMachine.setSettleState({
			progress: 1,
			active: false,
			latched: null,
			awaitTitle: false
		});
		this.#stateMachine.setSearchScrubbing(false);
		getMobilePagerStore().setTapMorph(null);
		// Clear the replaceState side-channel on a mobile -> desktop flip
		// so the intent does not survive the host that set it. Route-swap
		// displacement clears the same channel via releaseInputs.
		getMobilePagerStore().setReplaceStateIntent(false);
	}

	// -----------------------------------------------------------------------
	// Pointer events -> intent -> orchestrator.

	private forwardEvent(kind: IntentEventKind, x: number, y: number): void {
		if (this.#mountInputs === null) return;
		const event: IntentEvent = { kind, x, y, t: this.#clock(), target: null };
		this.#intent = classify(
			this.#intent,
			event,
			this.#classifierOpts,
			this.#mountInputs.viewportWidth
		);
		this.#interpretIntent();
	}

	/** A pointerdown arrived (from `detectSwipe` via the
	 *  `navPipelinePointer` action). */
	onPointerDown(x: number, y: number): void {
		this.forwardEvent('pointerdown', x, y);
	}

	/** A pointermove arrived (only fires once the gesture is claimed). */
	onPointerMove(x: number, y: number): void {
		this.forwardEvent('pointermove', x, y);
	}

	/** A pointerup arrived. When `velocity` and `reversed` are provided
	 *  (from `detectSwipe`'s `EndHandler`), they override the
	 *  classifier's own estimates: detectSwipe's rebound-based
	 *  `reversed` (peak minus final, with a forward-fling gate) and
	 *  trailing-window `velocity` are the authoritative release
	 *  signals for the commit/cancel decision. */
	onPointerUp(x: number, y: number, velocity?: number, reversed?: boolean): void {
		const inputs = this.#mountInputs;
		if (inputs === null) return;
		const event: IntentEvent = { kind: 'pointerup', x, y, t: this.#clock(), target: null };
		this.#intent = classify(this.#intent, event, this.#classifierOpts, inputs.viewportWidth);
		// Override with detectSwipe's authoritative release signals.
		if (velocity !== undefined) {
			this.#intent = { ...this.#intent, releaseVelocity: velocity, velocity };
		}
		if (reversed !== undefined) {
			this.#intent = { ...this.#intent, reversed };
		}
		// Override the offset with the final-release delta. The classifier's
		// pointerup preserves the last pointermove's offset; the commit gate
		// must read the release position.
		this.#intent = { ...this.#intent, offset: x - this.#intent.startX };
		this.#interpretIntent();
	}

	/** Interpret the latest intent state and feed the orchestrator +
	 *  executor. Runs on every event so the drag tracks 1:1. */
	#interpretIntent(): void {
		const inputs = this.#mountInputs;
		const executor = this.#executor;
		if (inputs === null || executor === null) return;
		const intent = this.#intent;
		// The host claims RIGHTWARD back-swipes always, and LEFTWARD
		// forward-swipes when bidirectional (the tab-pager host). A
		// gesture starts when micro transitions into a claimed drag
		// direction (a from-rest start or a re-grab mid-commit).
		const isRightDrag = intent.micro === 'drag-right';
		const isLeftDrag = inputs.bidirectional === true && intent.micro === 'drag-left';
		const isDrag = isRightDrag || isLeftDrag;
		const newDragStart = isDrag && !this.#prevWasDrag;
		this.#prevWasDrag = isDrag;
		// Deciding / idle: nothing to do.
		if (intent.micro === 'idle' || intent.micro === 'deciding') {
			return;
		}
		if (newDragStart) {
			this.#beginGesture(inputs, intent);
		}
		// During a claimed drag, stream the live progress to the executor.
		if (isDrag && this.#pendingGesture !== null && this.#publication.plan !== null) {
			// Reveal a header that hide-on-scroll had translated
			// off-screen, so the back-arrow + title are visible during
			// the back-swipe reveal (the host registers the
			// centre panel as the scroll-chrome source; the orchestrator
			// owns the transition, so it resets the chrome here). Idempotent.
			getScrollChromeStore().show();
			const rawDrag = this.#rawDragFraction(intent, inputs);
			const startProgress = this.#pendingGesture.startProgress;
			const rawStart = this.#pendingGesture.rawStart;
			// Rightward (rawDrag >= 0): for bidirectional hosts (the tab
			// pager) the drag maps onto the [startProgress, 1] window with no
			// threshold, so the track moves from the first pixel (no 20%
			// dead-zone) and a full drag completes the slide to TO. This is
			// 1:1 only from rest (startProgress = 0); a mid-commit re-grab
			// (startProgress != 0) scales the rate by (1 - startProgress) so
			// the full [startProgress, 1] span completes in one drag. For
			// non-bidirectional hosts (thread / deep page) the same window
			// mapping is threshold-absorbed (the first 20% of drag is absorbed
			// AT the start position), so the track never snaps back when a
			// gesture begins mid-transition.
			//
			// Leftward (rawDrag < 0): a mid-commit re-grab whose finger
			// then drags back left. The threshold-absorbed formula would
			// map the first 20% of LEFTWARD drag to 0 (freezing the track
			// at startProgress), so the undo direction bypasses the
			// threshold and tracks the finger 1:1 down toward 0. The lower
			// bound is min(0, startProgress): for a from-rest or
			// mid-transition grab with startProgress >= 0 the track stops
			// at 0 (the plan's at-rest); for a direction-reversing re-grab
			// whose extrapolated startProgress is negative (the visual is
			// rightward of the new plan's at-rest) the lower bound is
			// startProgress, so the track holds there, continuous with the
			// visual (§5 "No jump"). The boundary is consistent: at
			// rawDrag = 0 both branches yield exactly startProgress.
			const bidirectional = inputs.bidirectional === true;
			const isBoundary = this.#pendingGesture.boundary;
			const trackProgress = isBoundary
				? // Boundary rubber-band anchors at the gesture's start
					// progress so a re-grab that begins mid-commit (the in-flight
					// forward commit's visual is left of the at-rest tab) does not
					// jump to the at-rest position on the first drag frame. From
					// rest startProgress is 0 and the term is `max(0, rawDrag)
					// * factor`, i.e. a rubber-band that never crosses the at-rest
					// tab back into the panel range.
					startProgress + Math.max(0, rawDrag) * BOUNDARY_RUBBER_BAND_FACTOR
				: rawDrag < 0
					? Math.max(Math.min(0, startProgress), startProgress + rawDrag)
					: bidirectional
						? Math.min(1, startProgress + rawDrag * (1 - startProgress))
						: startProgress + this.#thresholdAbsorbedProgress(rawDrag) * (1 - startProgress);
			const raw = Math.max(0, Math.min(1, rawStart + rawDrag));
			executor.onDragMove(trackProgress, intent.offset);
			this.#stateMachine.onDragMove(intent);
			this.#publish(raw);
		}
		// Released: apply the commit-vs-cancel gate.
		if (intent.micro === 'committed' || intent.micro === 'cancelled') {
			this.#liveDragging = false;
			if (this.#pendingGesture !== null) {
				if (this.#pendingGesture.boundary) {
					// Boundary rubber-band: always snap back, never commit. The
					// guard fires for any non-zero progress: a direction-reversing
					// re-grab can leave the executor progress negative (the
					// in-flight forward visual is rightward of the boundary plan's
					// at-rest), and it must still cancel-animate back continuously
					// (§5 "No jump"). Progress exactly 0 (a from-rest boundary with
					// no drag) lands at rest with nothing to animate.
					if (executor.state.progress !== 0) {
						this.#commitStartRaw = this.#publication.progress;
						executor.onCancel(intent.releaseVelocity);
						getMobilePagerStore().setCommitted(false);
						this.#stateMachine.onCancel();
						// Arm the settle ease (cancel direction): the morph
						// + title crossfade retreat to the current page over
						// TITLE_CROSSFADE_MS.
						this.#armSettleEaseFromGesture(false);
					} else {
						this.#landAtRest();
					}
					this.#intent = initialIntentState();
					return;
				}
				const gestureDir = this.#pendingGesture.direction;
				// Only process the release when the intent's direction
				// matches the gesture's start direction. A cross-direction
				// touchup during a commit (a leftward tap during a
				// rightward commit on a non-bidirectional host, or vice
				// versa) must NOT trigger the release logic; the commit
				// runs to completion via the executor's rAF.
				const intentMatchesGesture =
					(gestureDir === 'backward' && intent.direction === 'right') ||
					(gestureDir === 'forward' && intent.direction === 'left');
				if (intentMatchesGesture) {
					// Normalize the signed offset: positive = toward the
					// gesture's target.
					const signedOffset = gestureDir === 'backward' ? intent.offset : -intent.offset;
					const reversed = intent.reversed;
					const shouldCommit = signedOffset >= SWIPE_COMMIT && !reversed;
					if (shouldCommit) {
						this.#commitStartRaw = this.#publication.progress;
						executor.onCommit(intent.releaseVelocity);
						getMobilePagerStore().setCommitted(true);
						this.#stateMachine.onCommit();
						// Arm the settle ease (commit direction): the morph
						// + title crossfade advance toward the back-target
						// over TITLE_CROSSFADE_MS, holding at progress 1
						// until the navigation lands.
						this.#armSettleEaseFromGesture(true);
					} else if (executor.state.progress > 0) {
						this.#commitStartRaw = this.#publication.progress;
						executor.onCancel(intent.releaseVelocity);
						getMobilePagerStore().setCommitted(false);
						this.#stateMachine.onCancel();
						this.#armSettleEaseFromGesture(false);
					} else {
						this.#landAtRest();
					}
				}
			}
			this.#intent = initialIntentState();
			return;
		}
	}

	/** Map the live drag offset to the RAW signed drag fraction.
	 *  Returns 0 at rest; +1 at a full viewport-width drag toward the
	 *  target; a NEGATIVE value when the finger has dragged backward
	 *  past the gesture start (a mid-commit re-grab whose finger then
	 *  tracks back). For a rightward (backward) gesture, the offset is
	 *  already positive toward the target. For a leftward (forward)
	 *  gesture, the offset is inverted so the fraction is positive
	 *  toward the next-tab target. */
	#rawDragFraction(intent: IntentState, inputs: PipelineMountInputs): number {
		const w = inputs.viewportWidth;
		if (w <= 0) return 0;
		if (intent.direction === 'right') {
			return Math.max(-1, Math.min(1, intent.offset / w));
		}
		if (intent.direction === 'left' && inputs.bidirectional === true) {
			return Math.max(-1, Math.min(1, -intent.offset / w));
		}
		return 0;
	}

	/** Map the RAW drag fraction to the threshold-absorbed progress the
	 *  executor uses for the TRACK translate. The first 20% of the
	 *  drag is absorbed (the track stays at rest); above 20% the drag
	 *  maps 1:1 onto the remaining [0, 1] window. */
	#thresholdAbsorbedProgress(raw: number): number {
		const THRESHOLD = HEADER_MORPH_THRESHOLD;
		if (raw <= THRESHOLD) return 0;
		return Math.max(0, Math.min(1, (raw - THRESHOLD) / (1 - THRESHOLD)));
	}

	/** Compute the start progress for a new transition so its first
	 *  frame matches the track's current visual position (interrupt
	 *  handoff). Reads the executor's authoritative current progress and
	 *  the running plan's geometry, converts through the absolute
	 *  translateX (`trackTranslateX`), and inverts into the new plan's
	 *  progress (`progressAtTranslateX`). Returns 0 when no transition
	 *  is in flight (the executor has no active plan).
	 *
	 *  Called from every transition-start path so the new transition
	 *  begins at the visual position the in-flight one currently
	 *  occupies, whatever its geometry. */
	#startProgressFromCurrentVisual(newPlan: TransitionPlan): number {
		const executor = this.#executor;
		if (executor === null) return 0;
		const activePlan = executor.activePlan;
		if (activePlan === null) return 0;
		const tx = trackTranslateX(activePlan, executor.state.progress);
		return progressAtTranslateX(newPlan, tx);
	}

	/** Lock FROM/TO and run the resolver + coordinator once. Handles both
	 *  rightward (backward, toward the back-target) and, when the host is
	 *  bidirectional, leftward (forward, toward the next tab) gestures. */
	#beginGesture(inputs: PipelineMountInputs, intent: IntentState): void {
		let direction: TransitionDirection;
		if (intent.direction === 'left' && inputs.bidirectional === true) {
			direction = 'forward';
		} else if (intent.direction === 'right') {
			direction = 'backward';
		} else {
			return;
		}
		// A re-grab mid-transition cancels every running animation ease
		// (settle + tap-scrub) and fires the §5 interrupt event so the
		// state machine drops the in-flight phase + TO before this
		// gesture's onResolved re-enters transitioning. The drag owns the
		// morph from the current visual position (no jump); each ease
		// would otherwise keep ticking underneath the drag. The interrupt
		// is required because the resolved handler preserves a 'committing'
		// sub when re-resolved mid-commit; clearing it here lets the new
		// drag re-enter 'dragging' so its drag-move/commit/cancel events
		// track correctly.
		this.#cancelAllAnimationEases();
		if (this.#publication.inFlight) {
			this.#stateMachine.onInterrupt(intent);
		}
		// A gesture now owns the publication. Clear the enter flag; a
		// re-grab continues coverProgress from the publication's live raw.
		this.#isEnterAnimation = false;
		this.#liveDragging = true;
		const from = inputs.fromPathname;
		const fromTag = inputs.fromTag;
		// Resolve the target for this direction. Backward targets the
		// previous tab (bidirectional hosts) or the mount-supplied
		// back-target (thread / deep-page hosts); forward targets the next
		// tab. For bidirectional hosts, when the history entry behind the
		// current tab is a DEEP page (the tab was reached by a forward nav
		// from a thread / profile / etc.), the backward gesture targets
		// that deep page so commit-settle dispatches `history.back()` to
		// it via `#dispatchNav`'s `hopForHref` check; the spatial switch
		// to the previous tab root would strand the originating page
		// between the two tabs in history.
		const target: string | null =
			direction === 'backward'
				? inputs.bidirectional === true
					? this.#backwardTabTarget(inputs)
					: inputs.backTarget
				: this.#nextTabTarget(inputs);
		// A gesture claims the transition: drop any in-flight tab-click so
		// #onExecutorSettle dispatches THIS gesture's target, not the
		// tab-click's. The two pending slots are mutually exclusive.
		this.#pendingTabExit = null;
		// Capture the in-flight raw BEFORE resetting the progress so a
		// re-grab mid-commit continues coverProgress from the live value.
		const rawStart = this.#progress;
		if (target === null) {
			// Boundary void-swipe on a bidirectional host (first/last tab):
			// start a rubber-band gesture that tracks the finger at a reduced
			// factor and always snaps back on release. No navigation is
			// dispatched.
			if (inputs.bidirectional !== true) return;
			const boundaryPlan: TransitionPlan = {
				pageTrack: {
					axis: direction === 'backward' ? 'right' : 'left',
					distance: inputs.viewportWidth,
					restingTranslate: inputs.restingTranslate
				},
				progressDirection: 1,
				commitPhysics: this.#driver?.prefersReducedMotion() ? 'snap' : 'momentum'
			};
			this.#gestureToTabIndex = null;
			this.#stateMachine.onIntent(intent, from, fromTag);
			this.#stateMachine.onResolved(boundaryPlan, from, from, fromTag, fromTag, direction);
			this.#progress = 0;
			const startProgress = this.#startProgressFromCurrentVisual(boundaryPlan);
			this.#pendingGesture = { to: from, startProgress, rawStart, direction, boundary: true };
			this.#executor?.onDragStart(boundaryPlan, startProgress, intent.offset);
			return;
		}
		const to: string = target;
		const toData = getRouteData(to);
		const toTag = toData.tag;
		const toTabIndex =
			direction === 'backward'
				? inputs.bidirectional === true
					? inputs.fromTabIndex - 1
					: inputs.toTabIndex
				: this.#tabIndexFor(to);
		this.#gestureToTabIndex = toTabIndex;
		const plan = this.#resolvePlan(inputs, intent, direction, to, toTabIndex);
		this.#stateMachine.onIntent(intent, from, fromTag);
		this.#stateMachine.onResolved(plan, from, to, fromTag, toTag, direction);
		this.#progress = 0;
		// Start the gesture at the track's current visual position so an
		// in-flight forward-enter or commit hands off with no jump.
		const startProgress = this.#startProgressFromCurrentVisual(plan);
		this.#pendingGesture = { to, startProgress, rawStart, direction, boundary: false };
		this.#executor?.onDragStart(plan, startProgress, intent.offset);
	}

	/** Resolve the next-tab target for a leftward (forward) gesture. Returns
	 *  null when the active tab is the last tab (no next neighbour). */
	#nextTabTarget(inputs: PipelineMountInputs): string | null {
		const nextIdx = inputs.fromTabIndex + 1;
		if (nextIdx >= MOBILE_TABS.length) return null;
		return MOBILE_TABS[nextIdx].href;
	}

	/** Resolve the previous-tab target for a rightward (backward) gesture on
	 *  a bidirectional host. Returns null when the active tab is the first
	 *  tab (no previous neighbour). Used only for bidirectional hosts (the
	 *  tab pager); non-bidirectional hosts (thread / deep-page host) use
	 *  the mount-supplied `backTarget` instead. */
	#prevTabTarget(inputs: PipelineMountInputs): string | null {
		const prevIdx = inputs.fromTabIndex - 1;
		if (prevIdx < 0) return null;
		return MOBILE_TABS[prevIdx].href;
	}

	/** Resolve the backward-gesture target for a bidirectional host.
	 *  When the history entry behind the current tab is a DEEP page
	 *  (reached this tab by a forward nav from a thread / profile /
	 *  etc.), the target is that deep page's pathname so commit-settle
	 *  dispatches `history.back()` to it (via `hopForHref` returning
	 *  `'back'` in `#dispatchNav`). When `fromTabIndex >= 1` the slide
	 *  reveals the previous tab's panel as a visual proxy; when
	 *  `fromTabIndex === 0` (the leftmost tab) there is no panel to the
	 *  left, so the slide reveals empty space until the deep page mounts
	 *  on commit. TODO(5b3): overlay the deep page's cached snapshot in
	 *  the left panel during the slide so the visual matches the landing
	 *  page (covers both the wrong-proxy and the empty-space cases).
	 *  Otherwise falls back to the spatially-previous
	 *  tab root. The deep page's tab association is not consulted: the
	 *  user came from that page, so `history.back()` returns to it
	 *  regardless of which tab it belongs to. */
	#backwardTabTarget(inputs: PipelineMountInputs): string | null {
		if (backSwipeShouldPopHistory()) {
			const deepTarget = previousEntryPathname();
			if (deepTarget !== null) return deepTarget;
		}
		return this.#prevTabTarget(inputs);
	}

	/** Resolve a transition plan for the locked FROM/TO/direction. */
	#resolvePlan(
		inputs: PipelineMountInputs,
		intent: IntentState,
		direction: TransitionDirection,
		toPathname: string,
		toTabIndex: number
	): TransitionPlan {
		const fromData = getRouteData(inputs.fromPathname);
		const toData = getRouteData(toPathname);
		const resolverInput: ResolverInput = {
			intent,
			stack: { entries: [] },
			from: fromData,
			to: toData,
			direction,
			fromPathname: inputs.fromPathname,
			toPathname,
			fromTabIndex: inputs.fromTabIndex,
			toTabIndex,
			viewportWidth: inputs.viewportWidth,
			reducedMotion: this.#driver?.prefersReducedMotion() ?? false
		};
		const resolver = selectResolver(fromData.tag, toData.tag);
		const plan = resolver(resolverInput);
		// Apply the multi-panel resting translate and slide distance.
		//
		// Non-bidirectional hosts (the 2-panel route host): panelCount is
		// always 2 (the track is 2*W wide; the centre is the right half).
		// restingTranslate = -W (FROM's centred position), distance = W;
		// progress 0 -> 1 maps the track from -W (centre fills the
		// viewport, left section off-screen) to 0 (left section fills,
		// centre off-screen).
		//
		// Bidirectional hosts (the 3-panel tab host): a tab click can span
		// more than one panel (e.g. tab 0 -> tab 2 = 2W). The slide
		// distance is `|toTabIndex - fromTabIndex| * W` so the track
		// travels the full multi-panel span in one rAF-driven motion.
		// `restingTranslate` stays `inputs.restingTranslate` (FROM's
		// centred position = `-activeIndex * W`): progress=0 leaves FROM
		// centred, progress=1 brings TO centred at
		// `restingTranslate + sign * distance`.
		const multiPanel =
			inputs.bidirectional === true &&
			inputs.fromTabIndex >= 0 &&
			toTabIndex >= 0 &&
			Math.abs(toTabIndex - inputs.fromTabIndex) > 1;
		// At the leftmost tab (fromTabIndex === 0) a backward-to-deep-page
		// gesture has no panel to the left to reveal (the 3-panel track's
		// panel 0 is leftmost), so a slide would reveal empty space. Suppress
		// the track slide (distance = 0); coverProgress still drives the
		// FAB/Header morph, and history.back() lands on the deep page on
		// commit. The clean visual fix is the 5b3 deep-snapshot overlay;
		// this avoids the empty-space artifact until then.
		const suppressSlide =
			inputs.bidirectional === true &&
			inputs.fromTabIndex === 0 &&
			direction === 'backward' &&
			toData.tag !== 'tab';
		const distance = suppressSlide
			? 0
			: multiPanel
				? Math.abs(toTabIndex - inputs.fromTabIndex) * inputs.viewportWidth
				: inputs.viewportWidth;
		return {
			...plan,
			pageTrack: {
				axis: plan.pageTrack.axis,
				distance,
				restingTranslate: inputs.restingTranslate
			}
		};
	}

	// -----------------------------------------------------------------------
	// Settle: dispatch the navigation on a commit; land on a cancel.

	/** Per-frame callback fired by the executor from `onCommit` (first
	 *  frame) and after each subsequent commit rAF sample. Publishes a
	 *  raw drag-fraction that is continuous with the
	 *  live-drag publication: it lerps from `#commitStartRaw` (the raw
	 *  captured at commit start) to the target raw (1 for a commit, 0
	 *  for a cancel) along the executor's eased fraction of the
	 *  progressStart -> progressTarget span. This keeps `coverProgress`
	 *  / `chipProgress` / `fractionalIndex` continuous across the
	 *  drag-to-commit boundary for every transition that runs a
	 *  commit/cancel rAF - a from-rest gesture, a mid-transition
	 *  interrupt (startProgress > 0), and a tab-click / enter
	 *  (#commitStartRaw = 0 when no live drag preceded it). A
	 *  sub-threshold cancel lands at rest immediately and does not run
	 *  this. */
	#onExecutorTick(progress: number): void {
		if (this.#publication.plan === null) return;
		const cs = this.#executor?.state.commitStart ?? null;
		if (cs === null) {
			this.#publish(progress);
			return;
		}
		const span = cs.progressTarget - cs.progressStart;
		const frac = span === 0 ? 1 : (progress - cs.progressStart) / span;
		const raw = this.#commitStartRaw + (cs.progressTarget - this.#commitStartRaw) * frac;
		this.#publish(raw);
	}

	#onExecutorSettle(progressDirection: 0 | 1): void {
		const pendingGesture = this.#pendingGesture;
		const pendingTabExit = this.#pendingTabExit;
		if (pendingGesture === null && pendingTabExit === null) {
			// Nothing to dispatch (a stray settle). Land at-rest.
			this.#landAtRest();
			return;
		}
		if (progressDirection === 1) {
			// Cancel: the user released below threshold; return to rest
			// without dispatching a nav.
			this.#landAtRest();
			return;
		}
		// Commit: dispatch the SvelteKit navigation via `goto` (or
		// `history.back` / `history.forward` for a hop). The dispatch
		// sets `navDispatchInFlight` so the orchestrator's
		// `onSvelteKitBeforeNavigate` passes it through without
		// re-cancelling.
		const target = pendingTabExit?.target ?? pendingGesture?.to;
		if (target === undefined || target === null) {
			this.#landAtRest();
			return;
		}
		// Commit: dispatch the SvelteKit navigation. The slide reveals the
		// left panel (the target's real panel when cached, or its skeleton);
		// the nav loads the target and the real page mounts, replacing it.
		this.#dispatchNav(target);
	}

	/** Dispatch the SvelteKit navigation. Per §9 the orchestrator
	 *  coordinates; it does not bypass SvelteKit. `goto` /
	 *  `history.back()` / `history.forward()` re-fire `beforeNavigate`;
	 *  the in-flight flag lets that one pass. Sets
	 *  `#lastLandWasPipelineCommit` at dispatch time so the Header's
	 *  `notifyHeaderState` `$effect.pre` (which fires BEFORE
	 *  `afterNavigate`) reads the current navigation's flag. */
	#dispatchNav(target: string): void {
		this.#navDispatchInFlight = true;
		this.#lastLandWasPipelineCommit = true;
		this.#dispatchTarget = target;
		const hop = hopForHref(target);
		// The in-flight flag + dispatch target persist until the
		// navigation lands. They are cleared in `#landAtRest` (called
		// from `onSvelteKitAfterNavigate` on the destination route)
		// or `releaseInputs` (called from the host's `onDestroy` when
		// the host route unmounts during the navigation). For the
		// `goto` path, `goto`'s promise resolves after the navigation
		// lands so the `.finally` cleanup is safe; the `history.back` /
		// `history.forward` paths have no promise to await, so they
		// rely on the lifecycle hooks to clear.
		if (hop === 'back') {
			history.back();
		} else if (hop === 'forward') {
			history.forward();
		} else {
			void goto(target, { replaceState: getMobilePagerStore().replaceStateIntent }).finally(() => {
				getMobilePagerStore().setReplaceStateIntent(false);
				this.#navDispatchInFlight = false;
				this.#dispatchTarget = null;
			});
		}
	}

	/** Return to at-rest without dispatching. */
	#landAtRest(): void {
		const inputs = this.#mountInputs;
		// The pipeline-commit flag was set at `#dispatchNav` time so the
		// Header's `notifyHeaderState` (firing before `afterNavigate`)
		// could read it. The navigation has landed; clear the flag so a
		// later non-pipeline nav does not mis-read it as a commit.
		this.#lastLandWasPipelineCommit = false;
		this.#pendingGesture = null;
		this.#pendingTabExit = null;
		this.#navDispatchInFlight = false;
		this.#dispatchTarget = null;
		this.#isEnterAnimation = false;
		this.#liveDragging = false;
		this.#gestureToTabIndex = null;
		this.#executor?.onLand();
		getMobilePagerStore().setCommitted(null);
		// Family-swap seed: a gesture that interrupted a mid-ease
		// family-swap set #fabDragSeedFraction. On a cancel landing (no
		// route swap, no configure), re-arm the ease from
		// #lastRenderedScale (the seeded publication kept it at the
		// visible scale, which at rest after the cancel snap is the eased
		// value) so the FAB continues to the destination family's resting
		// scale. On a commit landing, releaseInputs already captured
		// #lastRenderedScale for the next configure's
		// #detectFamilyChange; #familySwapRafId being defined means the
		// re-arm happened, and this branch is a no-op. Same-family commit
		// lands the FAB at the resting formula (no jump to zero: the
		// gesture's slide already drove the visual).
		if (this.#familySwapRafId === undefined && this.#fabDragSeedFraction !== null) {
			this.#fabDragSeedFraction = null;
			this.#startFamilySwapEase(this.#lastRenderedScale);
		}
		// Clear the replaceState side-channel: a cancel-after-regrab returns
		// to rest WITHOUT dispatching (no navigation lands, so
		// onSvelteKitAfterNavigate never fires), so the intent Header.onBack
		// set would leak to the next consumed dispatch without this clear.
		// (#landAtRest also runs after a normal landing, so this is
		// defense-in-depth alongside the onSvelteKitAfterNavigate clear.)
		getMobilePagerStore().setReplaceStateIntent(false);
		if (inputs !== null) {
			this.#stateMachine.onLand(inputs.fromTag);
		}
		this.#progress = 0;
		// Fire a queued discrete navigation (the finish-then-new policy).
		// The in-flight commit completed and the nav landed; replay the
		// queued tab-click so `onSvelteKitBeforeNavigate` intercepts it on
		// the active host and plays the transition from progress 0. The
		// queue is consumed exactly once (cleared before the goto fires).
		const queuedNav = this.#queuedDiscreteNav;
		this.#queuedDiscreteNav = null;
		if (queuedNav !== null) {
			void goto(queuedNav.target);
		}
	}

	// -----------------------------------------------------------------------
	// SvelteKit interop.

	/** Called from `+layout.svelte`'s `beforeNavigate` for pipeline-route
	 *  sources / destinations. Returns true if the orchestrator
	 *  consumed the navigation (cancelled + started a slide plan); the
	 *  layout hook does NOT also call the root layout's
	 *  `navStore.handleBeforeNavigate` in that case. */
	onSvelteKitBeforeNavigate(navigation: PilotBeforeNavigateEvent): boolean {
		const inputs = this.#mountInputs;
		if (inputs === null) return false;
		const from = navigation.from?.url.pathname ?? null;
		const to = navigation.to?.url.pathname ?? null;
		// The search (?q=... etc) of the target. Kept separate from `to`
		// (pathname) because the path-based checks below (isPilotFrom,
		// isTabRootPath) need the bare pathname, while the deferred
		// dispatch + re-entry match must carry the full URL.
		const toSearch = navigation.to?.url.search ?? '';
		// The orchestrator's own dispatch (goto / history.back /
		// history.forward) re-entering beforeNavigate. Two checks: the
		// in-flight flag (set at dispatch time) and a target match
		// (catches the re-entry across timer / popstate ordering so
		// the orchestrator never re-cancels its own nav). The match is
		// on the FULL target (pathname + search): #dispatchTarget carries
		// the search a tab-click preserved, so goto('/?q=foo') re-enters
		// with to='/' + toSearch='?q=foo' and matches.
		if (this.#navDispatchInFlight) {
			return false;
		}
		if (this.#dispatchTarget !== null && to !== null && to + toSearch === this.#dispatchTarget) {
			return false;
		}
		// Only own transitions FROM the host route (a tab-click exit or
		// a back-swipe equivalent). Transitions TO the host route
		// (deep-link landings) fall through; the afterNavigate hook
		// clears the state.
		if (from === null || !this.#isPilotFrom(inputs, from)) {
			return false;
		}
		if (to === null) return false;
		// Let the root layout hooks handle the navigation if the target
		// is also the host route (e.g. a paged conversation step within
		// the same route: `/messages/123/p1` -> `/messages/123/p2`).
		if (this.#isPilotFrom(inputs, to)) {
			return false;
		}
		// Only own transitions to a tab root (a tab-click exit or a
		// back-swipe equivalent). Transitions to other deep routes
		// (e.g. `/messages/<id>` -> `/discussion/<id>` via a sidebar
		// link) pass through to the root layout hooks; the slide
		// geometry is not meaningful for those (no pre-rendered
		// sibling, no Family A pill to drive).
		if (!isTabRootPath(to)) {
			return false;
		}
		// Finish-then-new interruption policy: a discrete tab-click
		// arriving while a commit slide is in flight (a gesture commit,
		// a prior tab-click commit, or a forward-enter) accelerates the
		// in-flight to completion, then replays this tab-click on the
		// landed host so its transition plays from progress 0. The
		// finger-controlled drag path (#beginGesture) keeps the current
		// behavior (track the finger from the current visual). The
		// live-drag phase (executor phase 'live') is not accelerated: a
		// finger is still controlling the track, so the discrete nav
		// falls through to the from-visual handoff below.
		if (this.#executor?.state.phase === 'committing') {
			this.#accelerateInFlight();
			this.#queuedDiscreteNav = { target: to + toSearch };
			navigation.cancel();
			return true;
		}
		// A tab-click exit (pipeline route -> tab-root). Drive the slide
		// plan via the executor and dispatch on settle. The direction
		// depends on the target's relative tab position: a higher index
		// is forward (leftward slide), a lower index is backward
		// (rightward slide). For non-bidirectional hosts the target is
		// always at a lower index (the back-target).
		const toPathname = to;
		const toTabIndex = this.#tabIndexFor(toPathname);
		const direction: TransitionDirection =
			inputs.bidirectional === true && toTabIndex > inputs.fromTabIndex ? 'forward' : 'backward';
		// Synthesize a "tap" intent so the resolver produces a commit plan.
		const intent = {
			...initialIntentState(),
			micro: 'committed' as const,
			target: toPathname,
			startedAt: this.#clock()
		};
		const plan = this.#resolvePlan(inputs, intent, direction, toPathname, toTabIndex);
		this.#pendingGesture = null;
		this.#liveDragging = false;
		this.#gestureToTabIndex = toTabIndex;
		// The full URL (pathname + search) so a tab-click to e.g. /?q=foo
		// dispatches to that exact URL, not the bare pathname.
		this.#pendingTabExit = { target: to + toSearch };
		this.#navDispatchInFlight = false;
		this.#dispatchTarget = null;
		navigation.cancel();
		// Capture the in-flight raw BEFORE resetting the progress so a
		// tab-click interrupting a gesture commit continues coverProgress
		// from the live value.
		this.#commitStartRaw = this.#progress;
		this.#isEnterAnimation = false;
		// Dispatch through the state machine so its macro state is the
		// authority the derived publication reads.
		const toData = getRouteData(toPathname);
		this.#stateMachine.onIntent(intent, inputs.fromPathname, inputs.fromTag);
		this.#stateMachine.onResolved(
			plan,
			inputs.fromPathname,
			toPathname,
			inputs.fromTag,
			toData.tag,
			direction
		);
		this.#progress = 0;
		const startProgress = this.#startProgressFromCurrentVisual(plan);
		// The slide uses the same 2-panel geometry whether the target is
		// the back-target or another tab root; the host renders the
		// target's real panel (cached) or its skeleton in the left slot,
		// so the slide reveals the correct content. Dispatch on settle.
		this.#executor?.onDragStart(plan, startProgress, 0);
		this.#executor?.onCommit(0, TAB_CLICK_COMMIT_MS);
		this.#stateMachine.onCommit();
		return true;
	}

	/** Called from `+layout.svelte`'s `afterNavigate` for pipeline-route
	 *  sources / destinations. For a host-internal param navigation
	 *  (`/messages/1` -> `/messages/2`) or the initial arrival this is a
	 *  no-op reset (the orchestrator is at rest). For a navigation AWAY
	 *  from the host route (a tab-click exit / a gesture settle), the host's
	 *  `onDestroy` runs before `afterNavigate` (Svelte 5 lifecycle: old
	 *  `onDestroy` -> new route mounts -> `afterNavigate`), so the active
	 *  slot is already null and this call is skipped; the cleanup is
	 *  handled by `onDestroy` -> `releaseInputs()`.
	 *
	 *  Guards: a forward-enter (`playEnterAnimation`) or an in-flight
	 *  gesture / tab-click that the orchestrator did NOT dispatch (an
	 *  external param-nav arriving mid-transition) must NOT call
	 *  `#landAtRest`; the in-flight transition owns the state and
	 *  settles on its own via `#onExecutorSettle`. The orchestrator's
	 *  OWN dispatch (`#navDispatchInFlight === true`) is the normal
	 *  landing: `#landAtRest` runs and clears the pending slots. */
	onSvelteKitAfterNavigate(): void {
		// Clear the replaceState side-channel on every navigation
		// landing. Header.onBack sets it before goto(replaceState:true);
		// a consumed nav's #dispatchNav reads + clears it via the goto
		// finally, but a non-consumed nav (onBack to a deep page, which
		// the orchestrator does not intercept) passes straight through to
		// SvelteKit with replaceState already applied, so the intent is
		// spent. Without this clear the stale intent leaks to the next
		// consumed dispatch, which then wrongly replaces history.
		getMobilePagerStore().setReplaceStateIntent(false);
		// Commit settle awaitTitle clear: a commit settle holds at
		// progress 1 until the navigation lands. The land clears the
		// await: an in-flight rAF endSettles at u=1 on its next tick (no
		// premature morph snap), a completed rAF endSettles now.
		if (this.#stateMachine.settleActive && this.#settleAwaitTitle) {
			if (this.#settleRafId !== undefined) {
				this.#settleAwaitTitle = false;
				this.#stateMachine.setSettleState({ awaitTitle: false });
			} else {
				this.#endSettleEase();
			}
		}
		if (this.#isEnterAnimation) return;
		if (
			!this.#navDispatchInFlight &&
			(this.#pendingGesture !== null || this.#pendingTabExit !== null)
		) {
			return;
		}
		this.#landAtRest();
	}

	#isPilotFrom(inputs: PipelineMountInputs, from: string): boolean {
		// The host's own pathname. Compare by prefix so a paged URL
		// (`/messages/123/p2`) still counts as the same host.
		const hostPath = inputs.fromPathname.replace(/\/p\d+$/, '');
		const fromStripped = from.replace(/\/p\d+$/, '');
		return hostPath === fromStripped;
	}

	#tabIndexFor(pathname: string): number {
		// The tab-bar pill index for `pathname` (the resolver's
		// `toTabIndex`); -1 when it is not a tab root. Sourced from the
		// canonical MOBILE_TABS order so a tab-set / order change does not
		// desync the resolver's pill interpolation.
		if (!isTabRootPath(pathname)) return -1;
		return MOBILE_TABS.findIndex((tab) => tab.href === pathname);
	}

	// -----------------------------------------------------------------------
	// Route-swap family-change ease (the FAB family-swap motion).

	/** Compute the FAB family of `pathname`, or null when the route does
	 *  not mount a FAB atom directly. */
	#familyOf(pathname: string): FabFamily | null {
		return getFabRouteAttributes(pathname)?.family ?? null;
	}

	/** Resolve the destination's FAB kind when an in-flight pipeline
	 *  transition targets a list-family route, mirroring the FAB layer's
	 *  `pilotTransitionListKind` derivation. Returns null at rest or when
	 *  the in-flight target's family is not 'list'. Read by the
	 *  family-swap ease's per-tick gate so a pipeline transition to a
	 *  list family (driven by `trackFractionalIndex`) cancels the ease
	 *  the same way a live drag does. */
	#pilotTransitionListKind(): 'discussions' | 'messages' | null {
		const target = this.#publication.toPathname;
		if (target === null) return null;
		const attrs = getFabRouteAttributes(target);
		if (attrs === null || attrs.family !== 'list') return null;
		if (attrs.kind === 'discussions') return 'discussions';
		if (attrs.kind === 'messages') return 'messages';
		return null;
	}

	/** Detect a family change between the route stored in
	 *  `#previousFamily` and the route now configuring, and start the
	 *  family-swap ease on a real change. No-op on the first configure
	 *  (#previousFamily === null) and on a same-family re-configure (a
	 *  tab swap within the list family). Reads #lastRenderedScale (the
	 *  visible pre-swap scale) as the ease's anchor so the trajectory is
	 *  continuous with the pre-swap render regardless of the at-rest
	 *  pager publication's timing. */
	#detectFamilyChange(newPathname: string): void {
		const newFamily = this.#familyOf(newPathname);
		const prev = this.#previousFamily;
		this.#previousFamily = newFamily;
		if (prev === null) return;
		if (prev === newFamily) return;
		this.#startFamilySwapEase(this.#lastRenderedScale);
	}

	/** Start the family-swap ease from `fromScale` to the destination
	 *  family's resting scale (captured on the first tick from
	 *  `#computeFabRestingScale`). Cancels any in-flight ease first (a
	 *  second family swap mid-ease); the caller passes the current
	 *  visible scale as `fromScale` so the trajectory stays continuous.
	 *  Pins the published `familySwapScale` to `fromScale` immediately
	 *  so the swap frame does not snap before the first tick. The ease
	 *  runs on the orchestrator's own rAF (distinct from the executor's
	 *  gesture rAF); one rAF owner per consumer of the FAB scale's
	 *  motion. Reduced-motion snaps (no rAF integration). */
	#startFamilySwapEase(fromScale: number): void {
		if (!browser) return;
		// Reduced-motion: drop familySwapScale so the FAB falls through to
		// the destination family's resting scale immediately. No rAF.
		if (this.#driver?.prefersReducedMotion() ?? false) {
			this.#stopFamilySwapEase();
			return;
		}
		if (this.#familySwapRafId !== undefined) {
			cancelAnimationFrame(this.#familySwapRafId);
		}
		this.#familySwapFromScale = fromScale;
		this.#familySwapToScale = fromScale;
		this.#familySwapToScaleCaptured = false;
		// The clock starts on the FIRST tick, not here: configure can run
		// during a SvelteKit navigation whose DOM work delays the first rAF
		// by many frames. Starting the clock here would make the first
		// tick compute a large elapsed `u` and skip the early-ease scale
		// range. Pinning familySwapScale to fromScale holds the FAB at the
		// pre-swap scale during that gap, then the ease runs the full curve
		// from the first real frame.
		this.#familySwapStartTs = 0;
		this.#publishFamilySwapScale(fromScale);
		this.#lastRenderedScale = fromScale;
		const tick = (): void => {
			// A higher-priority driver took over mid-ease: a live drag
			// (coverProgress drives the FAB) or a pipeline transition to a
			// list family (trackFractionalIndex drives the FAB). Hand the
			// scale back to the live / track signal.
			if (this.#liveDragging || this.#pilotTransitionListKind() !== null) {
				this.#stopFamilySwapEase();
				return;
			}
			const now = performance.now();
			if (!this.#familySwapToScaleCaptured) {
				// By the first tick the new mountInputs have settled and
				// #computeFabRestingScale reads the destination family's
				// resting publication; capture it as the ease target once
				// and start the clock on this frame so the full
				// TRACK_TRANSITION_MS curve plays.
				this.#familySwapToScale = this.#computeFabRestingScale();
				this.#familySwapToScaleCaptured = true;
				this.#familySwapStartTs = now;
			}
			const u = Math.min((now - this.#familySwapStartTs) / TRACK_TRANSITION_MS, 1);
			const eased = 2 * u - u * u;
			const scale =
				this.#familySwapFromScale + (this.#familySwapToScale - this.#familySwapFromScale) * eased;
			this.#publishFamilySwapScale(scale);
			this.#lastRenderedScale = scale;
			if (u >= 1) {
				// The ease can reach u=1 while a parallel pipeline slide is
				// still in flight (e.g. a forward-enter whose slide duration
				// matches TRACK_TRANSITION_MS but whose rAF started one
				// frame later). Hold at the destination scale until the
				// slide rests (coverProgress returns to 0 via the host's
				// at-rest $effect) so the resting formula's transient
				// mid-slide value never becomes the published scale for
				// that gap frame. A family swap with no parallel slide
				// has coverProgress 0 throughout, so it clears at u=1.
				if (getMobilePagerStore().coverProgress !== 0) {
					this.#publishFamilySwapScale(this.#familySwapToScale);
					this.#lastRenderedScale = this.#familySwapToScale;
					this.#familySwapRafId = requestAnimationFrame(tick);
					return;
				}
				this.#publishFamilySwapScale(null);
				this.#familySwapRafId = undefined;
				return;
			}
			this.#familySwapRafId = requestAnimationFrame(tick);
		};
		this.#familySwapRafId = requestAnimationFrame(tick);
	}

	/** Cancel the family-swap ease and hand the published FAB scale back
	 *  to the resting / live formula. Idempotent. */
	#stopFamilySwapEase(): void {
		if (this.#familySwapRafId !== undefined) {
			cancelAnimationFrame(this.#familySwapRafId);
			this.#familySwapRafId = undefined;
		}
		this.#publishFamilySwapScale(null);
	}

	/** Publish `value` (or clear it) to the pager store's
	 *  `familySwapScale` field. The FAB layer reads this in precedence
	 *  over its resting-scale formula. */
	#publishFamilySwapScale(value: number | null): void {
		getMobilePagerStore().setFamilySwapScale(value);
	}

	/** Compute the FAB's resting scale from the orchestrator's currently
	 *  published signals + the active route's FAB family, mirroring the
	 *  FAB layer's `foregroundFraction` -> `scaleFromFraction` pipeline.
	 *  Used to capture the ease target on the first tick (against the
	 *  destination route's at-rest publication) and to track
	 *  `#lastRenderedScale` after every `#republishToPager` (against the
	 *  in-flight publication) so the next family-swap ease anchors at
	 *  the visible pre-swap scale.
	 *
	 *  The dynamic kind (/activity, resolved from the gesture source tab)
	 *  resolves its FAB kind from the live fractional index, matching
	 *  the FAB layer's dynamic branch: at rest on /activity the resolved
	 *  kind is whichever list FAB sits at the published fractional index
	 *  (typically messages at index 1); when no FAB would render (a
	 *  fresh deep-link with no prior retained FAB) the scale is 0. */
	#computeFabRestingScale(): number {
		const inputs = this.#mountInputs;
		if (inputs === null) return 0;
		const attrs = getFabRouteAttributes(inputs.fromPathname);
		if (attrs === null) return 0;
		const family = attrs.family;
		const pager = getMobilePagerStore();
		// Match the FAB layer's foregroundFraction gate exactly: a pipeline
		// transition whose destination shows no resting FAB scales the FAB
		// OUT. Two cases: (1) non-tab host (trackFractionalIndex is null)
		// targeting a non-list destination - source family is overlay/compose
		// (resting scale 0), direct return 0; (2) tab host targeting a
		// non-tab destination (backward-to-deep-page) - when the source
		// route's tab matches the FAB's tab (resting scale 1, e.g. / or
		// /messages/inbox), ease out via `1 - coverProgress` so the scale
		// ramps 1 -> 0 over the first half of the slide (no jump at the
		// gate's first firing); when the source route shows no FAB at rest
		// (the dynamic kind at /activity's tab position 1, resting scale 0),
		// return 0 so the FAB stays hidden. Tab-to-tab on the tab host
		// passes through to the family === 'list' branch below.
		const transitionTarget = this.#publication.toPathname;
		if (
			transitionTarget !== null &&
			this.#pilotTransitionListKind() === null &&
			(pager.trackFractionalIndex === null || !isTabRootPath(transitionTarget))
		) {
			if (family === 'list') {
				// Mirror the FAB layer's source-rest check
				// (`tabFraction(sourceTab, cfg.tabIndex) === 0`). The
				// source FAB's tab index resolves via #listFabTabIndex;
				// null means the source route shows no FAB at rest (e.g.
				// /activity's dynamic kind), in which case the FAB layer
				// reads the retained config and tabFraction evaluates to 0
				// anyway. Uses inputs.fromTabIndex (stable at configure
				// time) rather than the live track fractional index (which
				// moves during the slide) so the check holds across every
				// frame.
				const sourceFabTabIndex = this.#listFabTabIndex(attrs.kind, pager);
				if (
					sourceFabTabIndex === null ||
					tabFraction(inputs.fromTabIndex, sourceFabTabIndex) === 0
				) {
					return 0;
				}
				return scaleFromFraction(1 - (pager.coverProgress ?? 0));
			}
			return 0;
		}
		if (family === 'list') {
			const fabTabIndex = this.#listFabTabIndex(attrs.kind, pager);
			if (fabTabIndex === null) return 0;
			const trackFrac = pager.trackFractionalIndex;
			if (trackFrac !== null) {
				return scaleFromFraction(tabFraction(trackFrac, fabTabIndex));
			}
			const restActiveTab = pager.active ? pager.fractionalIndex : inputs.fromTabIndex;
			return scaleFromFraction(tabFraction(restActiveTab, fabTabIndex));
		}
		return scaleFromFraction(pager.coverProgress ?? 0);
	}

	/** Resolve the FAB list-kind's tab index for `kind`. Returns null
	 *  when no FAB renders at rest (the dynamic kind on /activity at the
	 *  resting index, matching the FAB layer's dynamic branch). */
	#listFabTabIndex(
		kind: 'discussions' | 'messages' | 'dynamic' | 'deep' | null,
		pager: ReturnType<typeof getMobilePagerStore>
	): number | null {
		if (kind === 'discussions') return FAB_KIND_CONFIGS.discussions.tabIndex;
		if (kind === 'messages') return FAB_KIND_CONFIGS.messages.tabIndex;
		if (kind === 'dynamic') {
			// /activity resolves its FAB kind from the gesture source tab.
			// At rest the fractional index is 1 (activity's tab position);
			// when the index is exactly 1 no FAB renders via the dynamic
			// branch. Off-rest (a drag in flight) the index dips toward 0
			// (discussions) or rises toward 2 (messages).
			const trackFrac = pager.trackFractionalIndex;
			const sliding = trackFrac !== null && Math.abs(trackFrac - Math.round(trackFrac)) > 0.01;
			const index = sliding && trackFrac !== null ? trackFrac : pager.fractionalIndex;
			if (pager.active && Math.abs(index - 1) > 0.01) {
				return index < 1
					? FAB_KIND_CONFIGS.discussions.tabIndex
					: FAB_KIND_CONFIGS.messages.tabIndex;
			}
			return null;
		}
		return null;
	}

	// -----------------------------------------------------------------------
	// Settle ease (the Header morph + title crossfade owner).

	/** Arm the settle ease from `startProgress` toward `targetProgress` with
	 *  the latched endpoint identity (`latched`), over `durationMs`.
	 *  Reduced-motion snaps. `awaitTitle` true holds the settle at progress
	 *  1 after the rAF completes (a commit settle waiting for the
	 *  navigation to land); the afterNavigate hook + the title-change
	 *  watcher clear it via `#endSettleEase` when the nav lands. The
	 *  direction (`forward` / `back`) selects the title-span slide axis.
	 *
	 *  `durationMs`: the settle ease duration. A gesture-release settle
	 *  passes the executor's velocity-matched commit duration so the Header
	 *  morph / title crossfade tracks the slide end-to-end (§5 unified
	 *  following-visual model). A non-gesture settle (tab-click, plain title
	 *  change) passes `TITLE_CROSSFADE_MS`: those transitions are discrete
	 *  navs with no finger-release velocity to match.
	 *
	 *  Cancels any in-flight settle first (a rapid back-to-back nav). */
	#armSettleEase(
		latched: HeaderSettleTransition,
		startProgress: number,
		targetProgress: 0 | 1,
		awaitTitle: boolean,
		direction: 'forward' | 'back',
		durationMs: number = TITLE_CROSSFADE_MS
	): void {
		if (!browser) return;
		const safeDuration = Math.max(1, durationMs);
		this.#cancelSettleEaseRaf();
		this.#settleStartProgress = startProgress;
		this.#settleTargetProgress = targetProgress;
		this.#settleAwaitTitle = awaitTitle;
		this.#stateMachine.setSettleState({
			active: true,
			progress: startProgress,
			latched,
			direction,
			awaitTitle
		});
		// Reduced-motion: snap to target with no rAF. The awaitTitle flag
		// still holds for a commit settle (the nav-landing clear governs
		// endSettle); a non-gesture / cancel settle ends immediately.
		if (this.#driver?.prefersReducedMotion() ?? false) {
			this.#stateMachine.setSettleState({ progress: targetProgress });
			if (!awaitTitle) this.#endSettleEase();
			return;
		}
		this.#settleStartTs = 0;
		const tick = (): void => {
			const now = performance.now();
			if (this.#settleStartTs === 0) this.#settleStartTs = now;
			const u = Math.min((now - this.#settleStartTs) / safeDuration, 1);
			const eased = 2 * u - u * u;
			const progress =
				this.#settleStartProgress +
				(this.#settleTargetProgress - this.#settleStartProgress) * eased;
			this.#stateMachine.setSettleState({ progress });
			if (u >= 1) {
				this.#settleRafId = undefined;
				// Commit settle: hold at target, wait for the nav-landed
				// clear. Cancel / non-gesture settle: end now (no nav
				// landing to wait for; the rAF reaching u=1 is the
				// end-of-animation signal).
				if (!this.#settleAwaitTitle) this.#endSettleEase();
				return;
			}
			this.#settleRafId = requestAnimationFrame(tick);
		};
		this.#settleRafId = requestAnimationFrame(tick);
	}

	/** Cancel the settle rAF (no endSettle). Used by interrupt paths
	 *  (re-arm, drag-cancel, host destroy) where the settle state is
	 *  either overwritten by a fresh arm or cleared by releaseInputs. */
	#cancelSettleEaseRaf(): void {
		if (this.#settleRafId !== undefined) {
			cancelAnimationFrame(this.#settleRafId);
			this.#settleRafId = undefined;
		}
	}

	/** End the active settle: drop `settleActive` and clear the latched
	 *  record. The publication's `settleProgress` stays at its last value
	 *  (1 for commit, 0 for cancel) so the morph derivation's rest branch
	 *  produces the same value the settle branch ended at (no snap). */
	#endSettleEase(): void {
		if (!this.#stateMachine.settleActive) return;
		this.#cancelSettleEaseRaf();
		this.#settleAwaitTitle = false;
		this.#stateMachine.setSettleState({
			active: false,
			latched: null,
			awaitTitle: false
		});
	}

	/** Arm the settle ease for a gesture release (commit or cancel).
	 *  Outgoing = current page, incoming = the gesture's commit target.
	 *  The start progress is the executor's live raw at release so the
	 *  morph is continuous across the drag-to-settle boundary (no snap).
	 *  `committed` true → target 1 + awaitTitle; false → target 0, no
	 *  await.
	 *
	 *  The settle ease duration is the executor's velocity-matched commit
	 *  duration (`commitStart.durationMs`) so the Header morph / title
	 *  crossfade tracks the slide end-to-end. A fast release (~120ms) and
	 *  the Header settle finish together; a slow release (~600ms) and they
	 *  run together too. The cancel branch falls back to
	 *  `TITLE_CROSSFADE_MS` because a cancel snaps back from a
	 *  sub-threshold position with no velocity-matched slide to track. */
	#armSettleEaseFromGesture(committed: boolean): void {
		if (!browser) return;
		const inputs = this.#mountInputs;
		const pending = this.#pendingGesture;
		const executor = this.#executor;
		if (inputs === null || pending === null || executor === null) return;
		const back = pending.to;
		const t = this.#headerT;
		const outgoingTitle = t ? (resolveDeepHeaderTitle(inputs.fromPathname, t) ?? '') : '';
		const incomingTitle = t ? (resolveDeepHeaderTitle(back, t) ?? '') : '';
		const outgoingHasTabs = inputs.fromTabIndex >= 0;
		const incomingHasTabs = getCurrentTabIndex(back) >= 0;
		const latched: HeaderSettleTransition = {
			outgoingTitle,
			incomingTitle,
			outgoingHasTabs,
			incomingHasTabs
		};
		const startProgress = this.#publication.progress;
		const commitDurationMs = executor.state.commitStart?.durationMs ?? TITLE_CROSSFADE_MS;
		this.#armSettleEase(
			latched,
			startProgress,
			committed ? 1 : 0,
			committed, // awaitTitle only on a commit (cancel has no nav)
			'back',
			committed ? commitDurationMs : TITLE_CROSSFADE_MS
		);
	}

	// -----------------------------------------------------------------------
	// Root<->search tap-scrub ease.

	/** Arm the tap-scrub ease from `fromValue` to `toValue` over
	 *  TITLE_CROSSFADE_MS with the constant-deceleration ease `s(u) = 2u -
	 *  u²` (the same curve the executor's commit loop uses). Reduced-motion
	 *  snaps. Sets the start value synchronously so the Header's reactive
	 *  consumers (searchProgress / tabProgress) see tapMorph !== null in
	 *  the same flush and read the start value before the first rAF tick.
	 *  Latches scrubSource / scrubTargetTabs / scrubTerminal for the clear
	 *  watch in `notifyHeaderState`. */
	#armTapScrubEase(fromValue: number, toValue: number, source: string, targetTabs: boolean): void {
		if (!browser) return;
		this.#cancelTapScrubRaf();
		this.#scrubSource = source;
		this.#scrubTargetTabs = targetTabs;
		this.#scrubTerminal = toValue;
		this.#scrubFromValue = fromValue;
		this.#scrubToValue = toValue;
		this.#scrubStartTs = 0;
		const pager = getMobilePagerStore();
		this.#stateMachine.setSearchScrubbing(true);
		pager.setTapMorph(fromValue);
		// Reduced-motion: snap to target with no rAF.
		if (this.#driver?.prefersReducedMotion() ?? false) {
			pager.setTapMorph(toValue);
			this.#finishTapScrubEase();
			return;
		}
		const tick = (): void => {
			const now = performance.now();
			if (this.#scrubStartTs === 0) this.#scrubStartTs = now;
			const u = Math.min((now - this.#scrubStartTs) / TITLE_CROSSFADE_MS, 1);
			const eased = 2 * u - u * u;
			getMobilePagerStore().setTapMorph(
				this.#scrubFromValue + (this.#scrubToValue - this.#scrubFromValue) * eased
			);
			if (u >= 1) {
				this.#finishTapScrubEase();
				return;
			}
			this.#tapScrubRafId = requestAnimationFrame(tick);
		};
		this.#tapScrubRafId = requestAnimationFrame(tick);
	}

	/** Cancel the tap-scrub rAF (no clear). Used by interrupt paths
	 *  (drag-cancel, host destroy). */
	#cancelTapScrubRaf(): void {
		if (this.#tapScrubRafId !== undefined) {
			cancelAnimationFrame(this.#tapScrubRafId);
			this.#tapScrubRafId = undefined;
		}
	}

	/** Finish the tap-scrub ease: drop searchScrubbing and clear tapMorph
	 *  so the morph / trackMorph derivations fall through to the rest
	 *  branch (the destination route's at-rest value). Idempotent. */
	#finishTapScrubEase(): void {
		this.#cancelTapScrubRaf();
		this.#scrubSource = '';
		this.#stateMachine.setSearchScrubbing(false);
		getMobilePagerStore().setTapMorph(null);
	}

	/** Accelerate the in-flight commit to completion so a queued discrete
	 *  navigation can play afterward (the finish-then-new interruption
	 *  policy). Re-commits the executor from its current progress with a
	 *  shortened duration (100ms or half the remaining time, whichever is
	 *  shorter) so the slide finishes quickly and smoothly using the same
	 *  easing curve. Re-arms the settle ease from its current progress
	 *  with the same shortened duration so the Header morph / title
	 *  crossfade tracks the accelerated slide. The commit settles
	 *  naturally via `#onExecutorSettle`, dispatching the in-flight's own
	 *  nav target; the queued discrete nav fires on landing via
	 *  `#landAtRest`. */
	#accelerateInFlight(): void {
		const executor = this.#executor;
		if (executor === null) return;
		const cs = executor.state.commitStart;
		if (cs === null) return;
		const now = this.#clock();
		const elapsed = now - cs.t0;
		const remaining = Math.max(1, cs.durationMs - elapsed);
		const acceleratedMs = Math.max(1, Math.min(100, remaining / 2));
		// Capture the current raw so the accelerated commit's publication
		// is continuous with the in-flight's last frame.
		this.#commitStartRaw = this.#progress;
		executor.onCommit(0, acceleratedMs);
		// Accelerate the settle ease so the morph + title crossfade track
		// the accelerated slide (no visual desync between slide and header).
		if (this.#stateMachine.settleActive && this.#stateMachine.settleLatched !== null) {
			this.#armSettleEase(
				this.#stateMachine.settleLatched,
				this.#stateMachine.settleProgress,
				this.#settleTargetProgress,
				this.#settleAwaitTitle,
				this.#stateMachine.settleDirection,
				acceleratedMs
			);
		}
	}

	/** Centralized interruption: cancel every running animation ease
	 *  (settle + tap-scrub + family-swap) so a new gesture owns the
	 *  morph from the current visual position with no competing rAF
	 *  underneath. Called from `#beginGesture` on every re-grab
	 *  (from-rest or mid-transition). The Header's `notifyHeaderState`
	 *  reactive watcher for `pager.dragging` is a safety net for edge
	 *  cases where the gesture begins outside the orchestrator's pointer
	 *  path; this method is the primary cancellation point.
	 *
	 *  The family-swap rAF is cancelled and `pager.familySwapScale` is
	 *  cleared: the eased value is inverted into `#fabDragSeedFraction`
	 *  so `#republishToPager` seeds the FAB's foregroundFraction from the
	 *  eased value, letting the FAB scale continuously toward 1 as the
	 *  slide reveals the destination. `#landAtRest` (cancel) re-arms the
	 *  ease from `#lastRenderedScale`; `releaseInputs` (commit) captures
	 *  `#lastRenderedScale` for the next configure. Both clear the seed. */
	#cancelAllAnimationEases(): void {
		this.#endSettleEase();
		this.#finishTapScrubEase();
		if (this.#familySwapRafId !== undefined) {
			cancelAnimationFrame(this.#familySwapRafId);
			this.#familySwapRafId = undefined;
			const easedScale = this.#lastRenderedScale;
			this.#fabDragSeedFraction = (easedScale + 1) / 2;
			this.#publishFamilySwapScale(null);
		}
	}

	// -----------------------------------------------------------------------
	// Header-state detection (settle + tap-scrub arm triggers).

	/** Receive the live Header state (path / title / hasTabs / isSearch)
	 *  from the Header's reactive `$effect.pre` notification. The
	 *  orchestrator owns the detection: a gesture-release settle is armed
	 *  directly from `#interpretIntent`; a non-gesture title change arms
	 *  the settle ease here; a root<->search ENTER flip arms the tap-scrub
	 *  ease here. The Header is in a component scope so SvelteKit's
	 *  `$app/state` `page` reactivity reaches it; the orchestrator
	 *  singleton module does not, so the Header is the orchestrator's
	 *  sensor for path / title / hasTabs / isSearch and calls this method
	 *  on every change. The orchestrator tracks the previous values,
	 *  classifies the transition, and arms the appropriate ease. Also
	 *  handles the tap-scrub clear watch (terminal + redirect) and the
	 *  drag-cancel, since the orchestrator's reactive scope does not see
	 *  pager.dragging / pager.tapMorph flips. */
	notifyHeaderState(
		newPath: string,
		newTitle: string,
		currentHasTabs: boolean,
		currentIsSearch: boolean,
		t: TranslationDict
	): void {
		if (!browser) return;
		// Header persists in AppShell; on a mobile -> desktop flip the
		// orchestrator's `unmount` tears down the host inputs and clears
		// `#mounted`. The Header's `$effect.pre` keeps firing on
		// navigations, but with no host mounted the orchestrator must not
		// re-arm eases (the settle / tap-scrub rAFs would tick against
		// torn-down state). No-op until the next `configure`.
		if (!this.#mounted) return;
		this.#headerT = t;
		if (!this.#headerStateInitialized) {
			this.#prevHeaderTitle = newTitle;
			this.#prevHeaderHasTabs = currentHasTabs;
			this.#prevHeaderIsSearch = currentIsSearch;
			this.#headerStateInitialized = true;
			return;
		}
		const pager = getMobilePagerStore();
		// Clear watch + drag-cancel for an in-flight tap-scrub (the
		// Header's notification covers both, since the orchestrator's
		// reactive watchers do not fire on a singleton module scope).
		if (pager.tapMorph !== null) {
			const atTerminal = Math.abs(pager.tapMorph - this.#scrubTerminal) < 0.001;
			if (
				(pager.dragging && pager.tapMorph !== null) ||
				(atTerminal && currentHasTabs === this.#scrubTargetTabs) ||
				newPath !== this.#scrubSource
			) {
				this.#finishTapScrubEase();
			}
		}
		// Settle arm: title change. Skip while a drag or an in-flight
		// settle owns the morph (the in-flight settle handles the absorb /
		// re-arm below).
		if (pager.dragging) {
			this.#prevHeaderTitle = newTitle;
			this.#prevHeaderHasTabs = currentHasTabs;
			this.#prevHeaderIsSearch = currentIsSearch;
			return;
		}
		if (this.#stateMachine.settleActive) {
			// #lastLandWasPipelineCommit intentionally survives this
			// early-return: the read-and-clear below (idle branch) is
			// skipped when a title arrives mid-settle, so the flag
			// persists until #landAtRest clears it on the navigation's
			// afterNavigate landing.
			// A title arrived mid-settle: the awaited nav landed (clear
			// awaitTitle so an in-flight rAF endSettles at u=1; a
			// completed rAF endSettles now), OR a rapid back-to-back nav
			// re-arms toward a new title.
			if (newTitle === this.#resolveSettleIncomingTitle()) {
				if (this.#settleAwaitTitle) {
					if (this.#settleRafId !== undefined) {
						this.#settleAwaitTitle = false;
						this.#stateMachine.setSettleState({ awaitTitle: false });
					} else {
						this.#endSettleEase();
					}
				}
				this.#prevHeaderTitle = newTitle;
				this.#prevHeaderHasTabs = currentHasTabs;
				this.#prevHeaderIsSearch = currentIsSearch;
				return;
			}
			// A different title arrived mid-settle: re-arm toward the new
			// title so a rapid back-to-back nav cannot strand the header
			// on a stale title. Re-arm from the CURRENT settle progress so
			// the morph (tab-bar transition) and the title crossfade
			// continue from the in-flight position: the outgoing title
			// span keeps its mid-settle offset and the new incoming title
			// enters from below.
			if (
				newTitle !== this.#resolveSettleIncomingTitle() &&
				newTitle !== this.#resolveSettleOutgoingTitle()
			) {
				const prevLatched = this.#readSettleLatched();
				if (prevLatched !== null) {
					const latched: HeaderSettleTransition = {
						outgoingTitle: prevLatched.incomingTitle,
						incomingTitle: newTitle,
						outgoingHasTabs: prevLatched.incomingHasTabs,
						incomingHasTabs: currentHasTabs
					};
					this.#armSettleEase(
						latched,
						this.#stateMachine.settleProgress,
						1,
						false,
						this.#resolveNavDirection()
					);
				}
			}
			this.#prevHeaderTitle = newTitle;
			this.#prevHeaderHasTabs = currentHasTabs;
			this.#prevHeaderIsSearch = currentIsSearch;
			return;
		}
		// tap-scrub arm: ANY navigation that flipped `isSearch` (one side
		// is /search) AND did not land via the orchestrator's own commit
		// dispatch. Covers root<->search (the search-button tap), deep<->
		// search (/profile <-> /search, /messages/<id> <-> /search,
		// /search <-> /bookmarks, etc.), and any other isSearch flip the
		// orchestrator does not intercept pre-nav. The orchestrator owns
		// this motion on its rAF (§5: no CSS transitions in this layer);
		// the Header's horizontal-track / search-button / scope-tab-bar
		// readers follow `pager.tapMorph` while the scrub runs.
		//
		// The scrub values are `isSearch`-based (1 = not search, 0 =
		// search). This represents the search-layout position the Header
		// consumes (searchProgress = 1 - tapMorph) and drives both the
		// root<->search and the deep<->search trajectories; the hasTabs
		// signal cannot drive the latter (it is false at /profile and
		// /search).
		//
		// Skipped when `#lastLandWasPipelineCommit` is true: the
		// just-landed navigation was a pipeline gesture/tab-click commit,
		// and the executor's slide already drove the search-layout visual
		// to its post-land position (transitionTarget / backMorph during
		// the slide; `isSearch` at rest after). Arming a fresh scrub would
		// re-animate from the opposite endpoint and jump the track.
		const prevIsSearch = this.#prevHeaderIsSearch;
		const justLandedViaPipelineCommit = this.#lastLandWasPipelineCommit;
		this.#lastLandWasPipelineCommit = false;
		if (
			currentIsSearch !== prevIsSearch &&
			pager.transitionTarget === null &&
			!justLandedViaPipelineCommit
		) {
			const fromValue = prevIsSearch ? 0 : 1;
			const toValue = currentIsSearch ? 0 : 1;
			this.#armTapScrubEase(fromValue, toValue, newPath, currentHasTabs);
		}
		// Idle: arm the crossfade on any title change (including an empty
		// incoming title for a tab-root landing and an empty outgoing
		// title for a forward-from-tab click).
		if (newTitle !== this.#prevHeaderTitle) {
			const latched: HeaderSettleTransition = {
				outgoingTitle: this.#prevHeaderTitle,
				incomingTitle: newTitle,
				outgoingHasTabs: this.#prevHeaderHasTabs,
				incomingHasTabs: currentHasTabs
			};
			this.#armSettleEase(latched, 0, 1, false, this.#resolveNavDirection());
		}
		this.#prevHeaderTitle = newTitle;
		this.#prevHeaderHasTabs = currentHasTabs;
		this.#prevHeaderIsSearch = currentIsSearch;
	}

	#resolveSettleIncomingTitle(): string {
		return this.#stateMachine.settleLatched?.incomingTitle ?? '';
	}

	#resolveSettleOutgoingTitle(): string {
		return this.#stateMachine.settleLatched?.outgoingTitle ?? '';
	}

	#readSettleLatched(): HeaderSettleTransition | null {
		return this.#stateMachine.settleLatched;
	}

	#resolveNavDirection(): 'forward' | 'back' {
		return getNavigationStore().direction === 'backward' ? 'back' : 'forward';
	}

	// -----------------------------------------------------------------------
	// Reactive publication to the pager store.

	/** Reset the pager store to the at-rest publication. Called from two
	 *  sites: `configure()` (to publish the at-rest state with the freshly
	 *  captured mount inputs) and the host's `$effect` when the
	 *  orchestrator's plan transitions back to null (no transition in
	 *  flight). */
	resetPagerStore(): void {
		const pager = getMobilePagerStore();
		// No at-rest state to publish before configure (#mountInputs
		// captures the host route's tab data in configure()); skip so the
		// init $effect does not publish a placeholder fractionalIndex: -1
		// before configure
		// runs.
		if (this.#mountInputs === null) return;
		const inputs = this.#mountInputs;
		const centerTab = inputs?.centerTab;
		if (centerTab !== undefined) {
			// Thread route (the overlay family): the pill stays on centerTab
			// at rest, active: true so the FAB reads fractionalIndex,
			// backMorph: null so the Header stays in back-arrow mode for
			// the deep route.
			pager.set({
				fractionalIndex: centerTab,
				dragging: false,
				active: true,
				backMorph: null,
				targetIndex: null,
				coverProgress: 0,
				transitionTarget: null,
				committed: null
			});
		} else if (inputs?.bidirectional === true) {
			const fromIdx = inputs?.fromTabIndex ?? -1;
			// Tab host at rest (NavPipelineTabHost): the active tab is the
			// pill's resting index, active: true so the FAB reads the live
			// fractionalIndex, backMorph: null so the Header stays in
			// hamburger mode (tab-to-tab transitions never morph toward
			// the back-arrow).
			pager.set({
				fractionalIndex: fromIdx,
				dragging: false,
				active: true,
				backMorph: null,
				targetIndex: null,
				coverProgress: 0,
				transitionTarget: null,
				trackFractionalIndex: fromIdx,
				committed: null
			});
		} else {
			const fromIdx = inputs?.fromTabIndex ?? -1;
			// Deep page at rest (Family B without centerTab): no pill highlight
			// (fromTabIndex is -1 for routes with no tab association), active:
			// false so the FAB falls back to the URL-derived tab index,
			// backMorph: 0 so the Header is in normal (hamburger) mode.
			pager.set({
				fractionalIndex: fromIdx,
				dragging: false,
				active: false,
				backMorph: 0,
				targetIndex: null,
				coverProgress: 0,
				transitionTarget: null,
				committed: null
			});
		}
		// At-rest maintenance: capture the FAB's resting scale against the
		// just-published at-rest signals so the next route-swap family-change
		// ease anchors at the visible scale. Skipped during configure
		// (#mounted is still false here; configure sets it true after
		// #detectFamilyChange) because the ease must anchor at the pre-swap
		// scale captured by releaseInputs, not the destination route's
		// at-rest scale. Skipped while the family-swap ease runs (its tick
		// maintains #lastRenderedScale at the eased value).
		if (this.#mounted && this.#familySwapRafId === undefined) {
			this.#lastRenderedScale = this.#computeFabRestingScale();
		}
	}

	/** Refresh the from-pathname (and from-tag) after a same-host route
	 *  change (e.g. /messages/123 -> /messages/456 on a thread host, or a
	 *  tab swap on the tab pager) that reuses this host without remounting,
	 *  so a subsequent tab-exit is still owned (#isPilotFrom matches the
	 *  live pathname, not the stale mount pathname). Also refreshes
	 *  `fromTabIndex` when the new pathname is a tab root so the tab
	 *  pager's prev/next neighbour computation stays correct across tab
	 *  swaps. Non-tab-root pathnames (thread detail pages) keep their
	 *  mount-time `fromTabIndex` (the centerTab value). */
	updateFromPathname(pathname: string): void {
		const inputs = this.#mountInputs;
		if (inputs === null) return;
		if (this.#publication.inFlight) return;
		const newTabIdx = this.#tabIndexFor(pathname);
		this.#mountInputs = {
			...inputs,
			fromPathname: pathname,
			fromTag: getRouteData(pathname).tag,
			fromTabIndex: newTabIdx >= 0 ? newTabIdx : inputs.fromTabIndex
		};
	}

	/** Refresh the back-target after a navigation that reuses this host
	 *  without remounting (e.g. the user navigated from one tab to a deep
	 *  page, then to another tab, then back to the same deep page). The
	 *  resolved back-target follows the live navigation stack so a
	 *  back-swipe lands on the correct entry. Skipped during an in-flight
	 *  transition so a locked plan's geometry is not corrupted. */
	updateBackTarget(backTarget: string): void {
		const inputs = this.#mountInputs;
		if (inputs === null) return;
		if (this.#pendingGesture !== null || this.#pendingTabExit !== null || this.#isEnterAnimation)
			return;
		const toData = getRouteData(backTarget);
		this.#mountInputs = {
			...inputs,
			backTarget,
			toTag: toData.tag,
			toTabIndex: this.#tabIndexFor(backTarget)
		};
	}

	/** Internal: refresh the executor-driven progress and re-publish to
	 *  the pager store. Called from two paths, both passing a RAW drag
	 *  fraction on the same scale: (1) the live-drag path
	 *  (`#interpretIntent`) passes `offsetX / W` directly; (2) the
	 *  commit path (`#onExecutorTick`) lerps from `#commitStartRaw`
	 *  toward the target raw along the executor's eased fraction. Both
	 *  values drive `coverProgress` / `backMorph` / `fractionalIndex`
	 *  via `#republishToPager`. The macro fields (plan, FROM/TO,
	 *  direction, in-flight) stay owned by the state machine; only the
	 *  per-frame `#progress` mutates here. The host's `$effect` only
	 *  handles the at-rest reset (when `publication.plan` becomes null);
	 *  the in-flight pager publication is the orchestrator's
	 *  responsibility. */
	#publish(rawDragFraction: number): void {
		if (this.#publication.plan === null) return;
		this.#progress = rawDragFraction;
		this.#republishToPager(rawDragFraction);
	}

	/** Republish the current publication to the pager store. Three modes:
	 *
	 *  Thread mode (centerTab set): publishes `backMorph: null` so the
	 *  Header stays in root mode (hamburger + tab bar - centerTab routes
	 *  carry a pillTarget, so `resolveHeaderMode` returns 'root', not
	 *  'deep'). The tab-bar pill interpolates from `centerTab` toward the
	 *  gesture's target tab (a tab-click exit to a different tab) so the
	 *  highlight tracks the slide instead of jumping at landing; for a
	 *  same-tab back-swipe the target equals `centerTab` so the pill
	 *  holds. `targetIndex` stays null (the pill uses the fractionalIndex
	 *  path, not the deep-swipe path). `coverProgress` is the raw slide
	 *  fraction; the FAB layer resolves the destination's family/kind to
	 *  decide whether the FAB scales in.
	 *
	 *  Tab-host mode (no centerTab, bidirectional): interpolates
	 *  `fractionalIndex` between `fromTabIndex` and `toTabIndex`
	 *  (threshold-absorbed by `PILL_EXPANSION_THRESHOLD`) so the pill
	 *  follows the slide, but publishes `backMorph: null` so the Header
	 *  never morphs toward the back-arrow (tab-to-tab transitions stay
	 *  in hamburger mode end to end).
	 *
	 *  Deep-page mode (no centerTab, not bidirectional): same pill
	 *  interpolation, plus `backMorph: rawDragFraction` so the Header
	 *  morph and the FAB scale track the finger.
	 *
	 *  `transitionTarget` carries the in-flight destination so the FAB
	 *  layer can resolve that kind. */
	#republishToPager(rawDragFraction: number): void {
		const pager = getMobilePagerStore();
		const publication = this.#publication;
		const plan = publication.plan;
		if (plan === null) {
			return;
		}
		const inputs = this.#mountInputs;
		const centerTab = inputs?.centerTab;
		// When a gesture interrupted a family-swap ease, seed the FAB's
		// foregroundFraction so it advances from the eased value toward 1
		// as the slide reveals the destination. The seeded coverProgress
		// drives the FAB via its resting formula; the pill interpolation
		// and the Header morph still read the raw slide fraction.
		const seed = this.#fabDragSeedFraction;
		const coverProgress = seed !== null ? seed + (1 - seed) * rawDragFraction : rawDragFraction;
		if (centerTab !== undefined) {
			// The pill interpolates from centerTab toward the gesture's
			// target tab so a tab-click exit to a different tab tracks the
			// slide (a same-tab back-swipe targets centerTab, so the pill
			// holds). backMorph stays null so the Header does not morph
			// (centerTab routes are in root mode end to end); targetIndex
			// stays null so the pill uses the fractionalIndex path.
			const toIdx = this.#gestureToTabIndex ?? -1;
			const pillProgress =
				toIdx >= 0
					? Math.max(0, rawDragFraction - PILL_EXPANSION_THRESHOLD) / (1 - PILL_EXPANSION_THRESHOLD)
					: 0;
			pager.set({
				fractionalIndex: toIdx >= 0 ? centerTab + (toIdx - centerTab) * pillProgress : centerTab,
				dragging: publication.inFlight && this.#liveDragging,
				active: true,
				backMorph: null,
				targetIndex: null,
				coverProgress,
				transitionTarget: publication.toPathname
			});
			// Track the FAB's resting scale against the just-published
			// signals so the next route-swap family-change ease anchors at
			// the visible pre-swap scale (the orchestrator is the sole
			// owner of this tracking). Skipped while the family-swap ease
			// runs (its tick maintains #lastRenderedScale at the eased
			// value; a parallel slide publication must not overwrite it).
			if (this.#familySwapRafId === undefined) {
				this.#lastRenderedScale = this.#computeFabRestingScale();
			}
			return;
		}
		// No centerTab: tab host (bidirectional) or deep page. Both modes
		// share the pill interpolation; only backMorph differs (null for the
		// tab host so the Header stays in hamburger mode, the raw slide
		// fraction for a deep page so the Header morphs).
		const fromIdx = inputs?.fromTabIndex ?? -1;
		const toIdx = this.#gestureToTabIndex ?? inputs?.toTabIndex ?? -1;
		const pillProgress =
			toIdx >= 0
				? Math.max(0, rawDragFraction - PILL_EXPANSION_THRESHOLD) / (1 - PILL_EXPANSION_THRESHOLD)
				: 0;
		const bidirectional = inputs?.bidirectional === true;
		// The tab host's 1:1 track fractional position, published for the
		// Family A FAB (it follows the slide across a drag, a re-grab, and
		// the boundary rubber-band). Computed from the executor's
		// authoritative progress + the plan geometry so the FAB reads the
		// orchestrator's published signal (§5: no DOM read-back). null on a
		// deep page (no tab-host track).
		const viewportWidth = inputs?.viewportWidth ?? 0;
		const trackFrac =
			bidirectional && this.#executor !== null && viewportWidth > 0
				? -trackTranslateX(plan, this.#executor.state.progress) / viewportWidth
				: null;
		pager.set({
			fractionalIndex: toIdx >= 0 ? fromIdx + (toIdx - fromIdx) * pillProgress : fromIdx,
			dragging: publication.inFlight && this.#liveDragging,
			active: true,
			backMorph: bidirectional ? null : rawDragFraction,
			targetIndex: toIdx >= 0 ? toIdx : null,
			coverProgress,
			transitionTarget: publication.toPathname,
			trackFractionalIndex: trackFrac
		});
		// Track the FAB's resting scale against the just-published signals
		// (see the centerTab branch above for rationale + the ease-running
		// guard).
		if (this.#familySwapRafId === undefined) {
			this.#lastRenderedScale = this.#computeFabRestingScale();
		}
	}
}

/** The global singleton orchestrator. Constructed eagerly at module
 *  load so its `$state` / `$derived` fields bind to the module scope
 *  rather than the first host's component context (Svelte 5 rune
 *  ownership: reactive fields instantiated inside a component script
 *  are tied to that component and turn inert on its destroy, surfacing
 *  as `derived_inert` warnings and stale reads on the next host). One
 *  instance is shared by every mobile host for the app's lifetime. */
const globalOrchestrator: NavPipelineOrchestrator = new NavPipelineOrchestrator();

/** Get the global singleton orchestrator. Every mobile host
 *  (`NavPipelineHost` / `NavPipelineTabHost`) shares this instance; a
 *  route swap rebinds the inputs in place via `configure` /
 *  `releaseInputs` without reconstructing. */
export function getGlobalNavPipelineOrchestrator(): NavPipelineOrchestrator {
	return globalOrchestrator;
}

/** The active-slot pointer. With the global singleton, this is either the
 *  singleton (a host has called `configure`) or null (between
 *  `releaseInputs` and the next `configure`). `+layout.svelte` reads it via
 *  `getNavPipelineOrchestrator` so the SvelteKit nav hooks skip processing
 *  during the gap frame. */
let active: NavPipelineOrchestrator | null = null;

/** Get the active orchestrator (or null during the gap between
 *  `releaseInputs` and the next `configure`). */
export function getNavPipelineOrchestrator(): NavPipelineOrchestrator | null {
	return active;
}

/** Set the active orchestrator (a host has called `configure`). With the
 *  shared singleton the displacing-unmount branch never fires
 *  (`active === orch` always holds when both come from
 *  `getGlobalNavPipelineOrchestrator`); the branch is retained for the
 *  in-process test path that constructs orchestrators directly. */
export function setNavPipelineOrchestrator(orch: NavPipelineOrchestrator | null): void {
	if (orch !== null && active !== null && active !== orch) {
		active.unmount();
	}
	active = orch;
}

/** Release the active slot iff it still points at `orch` (a host's
 *  destroy). With the shared singleton both hosts hold the same instance,
 *  so the identity check distinguishes the destroy-the-current-host case
 *  from a newer host that has already configured. */
export function releaseNavPipelineOrchestrator(orch: NavPipelineOrchestrator): void {
	if (active === orch) {
		active = null;
	}
}

/** Test-only: clear the active slot. */
export function __resetNavPipelineOrchestrator(): void {
	active = null;
}
