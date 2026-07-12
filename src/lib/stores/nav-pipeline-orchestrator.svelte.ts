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
 *   3. Executor + driver -> elements: `mount({ resolveElements, ... })`
 *      constructs a `LiveNavDomDriver` whose `resolveElements` reads the
 *      host's track `bind:this` plus the FAB / Header via DOM queries;
 *      the executor writes the per-frame visual to those elements.
 *   4. Lifecycle: the host calls `mount` / `unmount` from its onMount /
 *      onDestroy and releases the html-singletons (viewport-lock) directly
 *      with a `browser` guard.
 *
 * Per the DV20 spec's binding "UNIFY, DO NOT BRIDGE" constraint: this
 * orchestrator is the SOLE transition mechanism for EVERY transition
 * type on EVERY mobile route. No `gestureSource` selector; no intent
 * mirror into the host component's `$state`; no CSS-transition +
 * `transitionend` path. Every mobile route mounts `NavPipelineHost` (the
 * thread and deep-page routes) or `NavPipelineTabHost` (the three tab
 * roots); the orchestrator constructed by each host drives every
 * transition through the executor's rAF.
 *
 * The orchestrator coordinates; it does NOT bypass SvelteKit (§9).
 * Settle on a commit dispatches the SvelteKit navigation via `goto`
 * (or `history.back()` / `history.forward()` for a hop) - the
 * orchestrator does not own its own navigation API. An internal
 * `navDispatchInFlight` flag lets the orchestrator's own goto re-fire
 * `beforeNavigate` without re-cancelling.
 *
 * Module-singleton pattern, matching the other reactive stores in this
 * directory. The host component (`NavPipelineHost` /
 * `NavPipelineTabHost`) is per-route; the orchestrator is constructed
 * fresh on each `mount` (so route swaps do not carry stale state) but
 * exposed via a single getter for the layout-level hooks.
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
import { MOBILE_TABS } from '$lib/utils/route-config';
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
	BOUNDARY_RUBBER_BAND_FACTOR
} from '$lib/utils/gesture-constants';
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
 *  fields (plan, FROM/TO, direction, in-flight); only `progress` is
 *  the executor's per-frame contribution. */
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
}

/** The clock function the intent classifier + executor use. */
type ClockFn = () => number;

function defaultClock(): number {
	if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
		return performance.now();
	}
	return Date.now();
}

/** The pipeline orchestrator. Constructed fresh on each host mount;
 *  torn down on unmount. Holds the NavStateMachine, NavExecutor,
 *  LiveNavDomDriver, the intent classifier state, and the lifecycle
 *  controller. */
export class NavPipelineOrchestrator {
	#stateMachine = getNavStateMachine();
	#executor: NavExecutor | null = null;
	#driver: LiveNavDomDriver | null = null;
	readonly #lifecycle = new PageLifecycleController(browser);
	#intent: IntentState = initialIntentState();
	#classifierOpts: IntentClassifierOptions = DEFAULT_CLASSIFIER_OPTIONS;
	readonly #clock: ClockFn;
	#mountInputs: PipelineMountInputs | null = null;
	/** A pending back-swipe gesture. `to` is the commit-settle dispatch
	 *  target; `startProgress` is the track's progress at gesture start,
	 *  read by the live-drag loop. Null at rest and after settle. */
	#pendingGesture: PendingGestureTransition | null = null;
	/** A pending tab-click transition. The orchestrator cancelled the
	 *  SvelteKit nav; `target` is the dispatch target fired on
	 *  commit-settle. Null at rest. */
	#pendingTabExit: PendingTabExit | null = null;
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
	 *  state (plan, FROM/TO, direction, in-flight phase) merged with the
	 *  executor-driven `#progress`. Per DV20 §13.5 the state machine is
	 *  the sole authority; this derived has no independent state. */
	readonly #publication = $derived.by<OrchestratorPublication>(() => {
		const sm = this.#stateMachine.state;
		return {
			plan: sm.macro.plan,
			progress: this.#progress,
			inFlight: sm.macro.kind === 'transitioning',
			fromPathname: sm.fromPathname,
			toPathname: sm.toPathname,
			direction: sm.direction
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

	/** Mount: construct the driver + executor + lifecycle activation.
	 *  Idempotent: re-mounting the same orchestrator with fresh inputs
	 *  re-binds the element refs (a tab swap) without leaking rAFs. */
	mount(inputs: PipelineMountInputs): void {
		this.unmount();
		this.#mountInputs = inputs;
		// The driver's element-resolver reads the host's bound element
		// refs each `write`. The PipelineElementResolver returns the
		// widened HTMLElement refs; the LiveNavDomDriver accepts those
		// structurally (its DriverElement subset is satisfied by
		// HTMLElement).
		const resolveElements: PipelineElementResolver = inputs.resolveElements;
		this.#driver = new LiveNavDomDriver({ resolveElements });
		this.#executor = new NavExecutor({
			driver: this.#driver,
			now: this.#clock,
			onSettle: (progressDirection) => this.#onExecutorSettle(progressDirection),
			onTick: (progress) => this.#onExecutorTick(progress)
		});
		this.#lifecycle.mount();
		this.#lifecycle.activate();
		// Reset the state machine (the singleton authority) to at-rest on
		// this route's tag so a stale phase from a prior mount does not
		// leak into the derived publication. The `forceReset` bypasses the
		// `reset` event's `intent` guard: the singleton may be in any phase
		// when a fresh orchestrator mounts.
		this.#stateMachine.forceReset(atRestOnFor(inputs.fromTag));
		this.#progress = 0;
		// Publish the at-rest pager state now that #mountInputs is set,
		// independent of the host reset $effect's timing.
		this.resetPagerStore();
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
		// (consistent with #beginGesture / onSvelteKitBeforeNavigate). For
		// a fresh mount the prior progress is 0 (at rest).
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
		// only on a fresh mount: the guard above returns if a transition
		// is in flight, and mount constructs a clean executor, so there is
		// no in-flight position to continue from.
		const startProgress = this.#startProgressFromCurrentVisual(plan);
		executor.onDragStart(plan, startProgress, 0);
		executor.onCommit(0, TAB_CLICK_COMMIT_MS);
		this.#stateMachine.onCommit();
	}

	/** Land an in-flight COMMIT transition when the platform flips mobile ->
	 *  desktop (called by the host's resize handler, NOT by a route-away
	 *  unmount). A commit-slide (progressDirection=0) in flight when the
	 *  viewport crosses the desktop breakpoint still lands on its target via
	 *  a viewport-flip handler (the mobile->desktop analogue of the
	 *  commit-settle dispatch, not a setTimeout-backed poll). A pre-commit live-
	 *  drag (executor still in the 'live' phase) and a cancel-slide
	 *  (progressDirection=1) do NOT land - the user may still cancel, or
	 *  already cancelled. A route-away unmount (onDestroy) does not call
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

	/** Unmount: stop the rAF, drop the plan, run lifecycle teardowns.
	 *  Idempotent. */
	unmount(): void {
		this.#executor?.stop();
		this.#executor = null;
		this.#driver = null;
		this.#pendingGesture = null;
		this.#pendingTabExit = null;
		this.#navDispatchInFlight = false;
		this.#dispatchTarget = null;
		this.#intent = initialIntentState();
		this.#progress = 0;
		// Reset every transient transition field so an idempotent re-mount
		// (a future caller reusing the instance) starts clean.
		this.#isEnterAnimation = false;
		this.#commitStartRaw = 0;
		this.#liveDragging = false;
		this.#prevWasDrag = false;
		this.#gestureToTabIndex = null;
		this.#lifecycle.deactivate();
		this.#lifecycle.unmount();
		// Clear the in-flight pager state so a stale fractionalIndex /
		// transitionTarget does not drive the FAB on the destination route
		// before that route publishes its own state (mirrors the at-rest pager
		// publication each host sets on mount).
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
		// must read the release position, matching GPL's `deltaX` (detectSwipe's
		// onEnd argument).
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
			// Match GPL's onSwipeMove: reveal a header that hide-on-scroll
			// had translated off-screen, so the back-arrow + title are
			// visible during the back-swipe reveal (the host registers the
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
					} else if (executor.state.progress > 0) {
						this.#commitStartRaw = this.#publication.progress;
						executor.onCancel(intent.releaseVelocity);
						getMobilePagerStore().setCommitted(false);
						this.#stateMachine.onCancel();
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
		// A re-grab mid-transition (an in-flight gesture or tab-click)
		// fires the §5 interrupt event so the state machine drops the
		// in-flight phase + TO before this gesture's onResolved re-enters
		// transitioning. The interrupt is required because the resolved
		// handler preserves a 'committing' sub when re-resolved mid-commit;
		// clearing it here lets the new drag re-enter 'dragging' so its
		// drag-move/commit/cancel events track correctly.
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
	 *  `'back'` in `#dispatchNav`). The slide reveals the previous tab
	 *  panel as a visual proxy; on commit the deep page route mounts and
	 *  the tab host unmounts. TODO(5b3): overlay the deep page's cached
	 *  snapshot in the left panel during the slide so the visual matches
	 *  the landing page. Otherwise falls back to the spatially-previous
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
		const distance = multiPanel
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
	 *  the in-flight flag lets that one pass. */
	#dispatchNav(target: string): void {
		this.#navDispatchInFlight = true;
		this.#dispatchTarget = target;
		const hop = hopForHref(target);
		// The in-flight flag + dispatch target persist until the
		// navigation lands. They are cleared in `#landAtRest` (called
		// from `onSvelteKitAfterNavigate` on the destination route)
		// or `unmount` (called from the host's `onDestroy` when the
		// host route unmounts during the navigation). For the `goto`
		// path, `goto`'s promise resolves after the navigation lands
		// so the `.finally` cleanup is safe; the `history.back` /
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
		this.#pendingGesture = null;
		this.#pendingTabExit = null;
		this.#navDispatchInFlight = false;
		this.#dispatchTarget = null;
		this.#isEnterAnimation = false;
		this.#liveDragging = false;
		this.#gestureToTabIndex = null;
		this.#executor?.onLand();
		getMobilePagerStore().setCommitted(null);
		if (inputs !== null) {
			this.#stateMachine.onLand(inputs.fromTag);
		}
		this.#progress = 0;
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
	 *  `onDestroy` -> new route mounts -> `afterNavigate`), so the
	 *  singleton is already null and this call is skipped; the cleanup is
	 *  handled by `onDestroy` -> `unmount()`.
	 *
	 *  Guards: a forward-enter (`playEnterAnimation`) or an in-flight
	 *  gesture / tab-click that the orchestrator did NOT dispatch (an
	 *  external param-nav arriving mid-transition) must NOT call
	 *  `#landAtRest`; the in-flight transition owns the state and
	 *  settles on its own via `#onExecutorSettle`. The orchestrator's
	 *  OWN dispatch (`#navDispatchInFlight === true`) is the normal
	 *  landing: `#landAtRest` runs and clears the pending slots. */
	onSvelteKitAfterNavigate(): void {
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
	// Reactive publication to the pager store.

	/** Reset the pager store to the at-rest publication. Called from two
	 *  sites: `mount()` (to publish the at-rest state with the freshly
	 *  captured mount inputs) and the host's `$effect` when the
	 *  orchestrator's plan transitions back to null (no transition in
	 *  flight). */
	resetPagerStore(): void {
		const pager = getMobilePagerStore();
		// No at-rest state to publish before mount (#mountInputs captures
		// the host route's tab data in mount()); skip so the init $effect
		// does not publish a placeholder fractionalIndex: -1 before mount
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
				transitionTarget: null
			});
			return;
		}
		const fromIdx = inputs?.fromTabIndex ?? -1;
		if (inputs?.bidirectional === true) {
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
				trackFractionalIndex: fromIdx
			});
			return;
		}
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
	 *  Thread mode (centerTab set): publishes `backMorph: null,
	 *  targetIndex: null, fractionalIndex: centerTab` (constant) so the
	 *  Header stays in back-arrow mode and the tab-bar pill stays
	 *  highlighted at centerTab throughout the gesture. `coverProgress`
	 *  is the raw slide fraction; the FAB layer resolves the
	 *  destination's family/kind to decide whether the FAB scales in.
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
		const coverProgress = rawDragFraction;
		if (centerTab !== undefined) {
			pager.set({
				fractionalIndex: centerTab,
				dragging: publication.inFlight && this.#liveDragging,
				active: true,
				backMorph: null,
				targetIndex: null,
				coverProgress,
				transitionTarget: publication.toPathname
			});
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
	}
}

/** The module singleton. The host constructs a fresh orchestrator on
 *  each mount and assigns it via `setNavPipelineOrchestrator`;
 *  `+layout.svelte` reads it via `getNavPipelineOrchestrator` so the
 *  SvelteKit nav hooks reach the active orchestrator. */
let active: NavPipelineOrchestrator | null = null;

/** Get the active orchestrator (or null if no host is mounted). */
export function getNavPipelineOrchestrator(): NavPipelineOrchestrator | null {
	return active;
}

/** Set the active orchestrator (a mount). A non-null `orch` displaces any
 *  prior active. Pass the host's own orchestrator to
 *  `releaseNavPipelineOrchestrator` on destroy / desktop-unmount (not
 *  null) so a newer mount that landed first is not orphaned. */
export function setNavPipelineOrchestrator(orch: NavPipelineOrchestrator | null): void {
	if (orch !== null && active !== null && active !== orch) {
		active.unmount();
	}
	active = orch;
}

/** Release the active slot iff it still points at `orch` (a host's destroy
 *  / desktop-unmount). Identity-checked so a newer mount is not cleared by
 *  an older host's teardown. */
export function releaseNavPipelineOrchestrator(orch: NavPipelineOrchestrator): void {
	if (active === orch) {
		active = null;
	}
}

/** Test-only: clear the singleton. */
export function __resetNavPipelineOrchestrator(): void {
	active = null;
}
