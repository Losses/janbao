// src/lib/stores/nav-pipeline-orchestrator.svelte.ts
/**
 * The Cycle 5b1 pilot-route orchestrator integration. Owns the wiring
 * of the four integration points the C05b1 spec requires for the pilot
 * route `/messages/[id]`:
 *
 *   1. SvelteKit nav -> orchestrator: `onSvelteKitBeforeNavigate` /
 *      `onSvelteKitAfterNavigate` (called from `src/routes/+layout.svelte`'s
 *      hooks, gated by `isNavPipelinePilotRoute`).
 *   2. Pointer -> intent: `onPointerDown` / `onPointerMove` /
 *      `onPointerUp` / `onPointerCancel` (called from the
 *      `navPipelinePointer` Svelte action that wraps `detectSwipe`).
 *   3. Executor + driver -> elements: `mount({ resolveElements, ... })`
 *      constructs a `LiveNavDomDriver` whose `resolveElements` reads the
 *      host's track `bind:this` plus the FAB / Header via DOM queries;
 *      the executor writes the per-frame visual to those elements.
 *   4. Lifecycle: the host calls `mount` / `unmount` from its onMount /
 *      onDestroy; `registerTeardown` lists html-singleton releases.
 *
 * Per the C05b1 spec's binding "UNIFY, DO NOT BRIDGE" constraint: for
 * the pilot route, this orchestrator is the SOLE transition mechanism
 * for EVERY transition type. No `gestureSource` selector; no intent
 * mirror into the host component's `$state`; the
 * `detectSwipe -> $state -> CSS transition -> transitionend` path used
 * by `GesturePageLayout` (still active on non-pilot routes in 5b1) is
 * not mounted on the pilot.
 *
 * The orchestrator coordinates; it does NOT bypass SvelteKit (§9).
 * Settle on a commit dispatches the SvelteKit navigation via `goto`
 * (or `history.back()` / `history.forward()` for a hop) - the
 * orchestrator does not own its own navigation API. An internal
 * `navDispatchInFlight` flag lets the orchestrator's own goto re-fire
 * `beforeNavigate` without re-cancelling.
 *
 * Module-singleton pattern, matching the other reactive stores in this
 * directory. The host component (`NavPipelineHost`) is per-route; the
 * orchestrator is constructed fresh on each `mount` (so route swaps do
 * not carry stale state) but exposed via a single getter for the
 * layout-level hooks.
 */

import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { getMobilePagerStore } from '$lib/stores/mobile-pager.svelte';
import { getPageCacheStore } from '$lib/stores/page-cache.svelte';
import type { VoidHandler } from '$lib/types/handlers';
import { getNavStateMachine } from '$lib/stores/nav-state-machine.svelte';
import { NavExecutor } from '$lib/stores/nav-executor.svelte';
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
import { coordinate } from '$lib/utils/nav-coordinator';
import {
	selectResolver,
	type ResolverInput,
	type TransitionDirection
} from '$lib/utils/nav-resolvers';
import { getRouteData } from '$lib/utils/route-data';
import { hopForHref, isTabRootPath } from '$lib/utils/history-nav';
import { TRACK_TRANSITION_MS, SWIPE_COMMIT } from '$lib/utils/gesture-constants';
import type { RouteTag } from '$lib/utils/route-data';
import type { TransitionPlan } from '$lib/utils/nav-resolvers';

/** Commit duration for the pilot's tab-click exit. Matches the
 *  non-pilot routes' CSS `transition-transform duration-200`
 *  (`TRACK_TRANSITION_MS`) so the pilot's exit slide is
 *  indistinguishable from a non-pilot GPL route's tab-exit. Gesture
 *  commits use the velocity-matched solver instead. */
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

/** A pending gesture transition (a back-swipe). Carries the locked
 *  FROM / TO / direction so the resolver runs once per gesture. */
interface PendingGestureTransition {
	readonly from: string;
	readonly fromTag: RouteTag;
	readonly to: string;
	readonly toTag: RouteTag;
	readonly direction: TransitionDirection;
}

/** A pending tab-click transition (any pilot -> tab-root nav the
 *  orchestrator cancelled in `onSvelteKitBeforeNavigate`). Carries
 *  the deferred dispatch target so commit-settle can fire the
 *  SvelteKit `goto`. The `chipExit` flag marks the cross-tab-exit
 *  variant (target is not the pilot's pre-rendered leftHref) where
 *  the LoadingChip overlay stands in for the un-pre-rendered
 *  sibling; non-chipExit (target IS the leftHref) plays a clean
 *  slide that reveals the pre-rendered panel. */
interface PendingTabExit {
	readonly target: string;
	readonly svelteKitType: string;
	readonly chipExit: boolean;
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
	 *  For the pilot's 2-panel track this is `-viewportWidth` so the
	 *  centre panel (the right half of the 2*W track) fills the
	 *  viewport and the left panel sits off-screen. The plan's
	 *  `pageTrack.restingTranslate` field carries this into the
	 *  executor's `buildVisual`. */
	readonly restingTranslate: number;
	/** The pilot route's back-target (the `leftHref` prop, resolved
	 *  host-side to the actual URL). */
	readonly backTarget: string;
	/** The current route's pathname (the pilot detail route). */
	readonly fromPathname: string;
	/** The current route's tag (`'detail'` for the pilot). */
	readonly fromTag: RouteTag;
	/** The back-target's tag (`'tab'` for `/messages/inbox`). */
	readonly toTag: RouteTag;
	/** Index of the FROM route in the tab-bar's pill order, or -1
	 *  when FROM is not a tab root. */
	readonly fromTabIndex: number;
	/** Index of the back-target in the tab-bar's pill order, or -1
	 *  when TO is not a tab root. */
	readonly toTabIndex: number;
	/** The pilot's `centerTab` prop (the tab index the conversation
	 *  page is centered on, e.g. 2 for messages). When set, the
	 *  orchestrator publishes `backMorph: null, targetIndex: null,
	 *  fractionalIndex: centerTab` (constant) to the pager store,
	 *  matching the centerTab branch of GesturePageLayout. When
	 *  undefined (deep routes in 5b2), the morph values apply. */
	readonly centerTab?: number;
}

/** The orchestrator's published reactive state for downstream
 *  consumers (the host's `$effect` reads this and publishes to the
 *  pager store so the existing FAB / Header layers react). */
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
	/** True when the orchestrator is running a chip-exit (LoadingChip
	 *  overlay shown; preload in flight). */
	readonly chipExit: boolean;
}

/** A noop publication used at-rest. */
const AT_REST_PUBLICATION: OrchestratorPublication = {
	plan: null,
	progress: 0,
	inFlight: false,
	fromPathname: null,
	toPathname: null,
	direction: null,
	chipExit: false
};

const NO_OP_PLAN: TransitionPlan | null = null;

/** The clock function the intent classifier + executor use. */
type ClockFn = () => number;

function defaultClock(): number {
	if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
		return performance.now();
	}
	return Date.now();
}

/** The 5b1 pilot-route orchestrator. Constructed fresh on each pilot
 *  mount; torn down on unmount. Holds the NavStateMachine, NavExecutor,
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
	/** A pending transition to drive once a gesture's intent is
	 *  classified as a drag. Carries the locked FROM/TO/pathnames/tags
	 *  so the resolver runs once per gesture. */
	#pendingGesture: PendingGestureTransition | null = null;
	/** A pending tab-click transition. The orchestrator cancelled the
	 *  SvelteKit nav; once the commit rAF settles this carries the
	 *  dispatch target + the chipExit flag (true when the target is
	 *  not the pilot's pre-rendered leftHref). */
	#pendingTabExit: PendingTabExit | null = null;
	/** True while the forward-enter animation (playEnterAnimation) is
	 *  active. Suppresses the coverProgress ramp in #republishToPager:
	 *  during a forward-enter the source list is being COVERED (not
	 *  revealed), so coverProgress stays 0, matching GPL's centerTab
	 *  branch. */
	#isEnterAnimation = false;
	/** True only while the live pointer is actively dragging (micro is
	 *  drag-left / drag-right). Set false on release (committed /
	 *  cancelled). Controls the pager store's `dragging` field: GPL
	 *  publishes `dragging: dragOffset !== null` which is true during
	 *  live drag only, NOT during the commit slide (dragOffset is
	 *  nulled on release). Matching this prevents the FAB / Header
	 *  CSS transitions from being disabled during the commit slide. */
	#liveDragging = false;
	/** True when the orchestrator's own goto has fired and is
	 *  re-entering beforeNavigate. Lets the orchestrator's
	 *  beforeNavigate handler pass it through. */
	#navDispatchInFlight = $state(false);
	/** The most recent dispatch's target pathname. The robust
	 *  pass-through check in `onSvelteKitBeforeNavigate`: matching
	 *  the nav's `to` against the dispatched target catches the
	 *  orchestrator's own `goto` / `history.back()` re-entry
	 *  regardless of timer or popstate ordering. */
	#dispatchTarget: string | null = null;
	/** Reactive publication (the source of truth for the host's $effect
	 *  that mirrors into the pager store). */
	#publication = $state<OrchestratorPublication>(AT_REST_PUBLICATION);
	/** Dedicated `$state` for the chipExit flag so the host's `{#if !chipExit}`
	 *  template block updates the same frame the orchestrator flips it.
	 *  Carrying chipExit inside the `#publication` object literal caused
	 *  the host's $derived-of-$derived read to lag a flush behind the
	 *  underlying write, which left the left section in the DOM for the
	 *  first ~3 rAF ticks of a chip-exit slide. */
	#chipExitState = $state(false);

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

	/** Reactive read of the chipExit flag. The host reads this in a
	 *  `$derived` so the {#if !chipExit} template block updates the
	 *  same frame the orchestrator flips it. */
	get chipExit(): boolean {
		return this.#chipExitState;
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
		// Reset the at-rest publication. The state machine may have a
		// stale at-rest surface from a prior pilot mount (e.g. after a
		// route swap); align it to the pilot's FROM tag so a land event
		// settles to the right surface.
		this.#publication = AT_REST_PUBLICATION;
		this.#chipExitState = false;
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
		this.#mountInputs = {
			...current,
			viewportWidth,
			restingTranslate
		};
	}

	/** Play a forward enter-slide animation (left panel → centre
	 *  panel). Called from the host's `onMount` when the pilot route
	 *  is reached via a forward SPA navigation from the backTarget.
	 *  The track starts at `translateX(0)` (left panel visible) and
	 *  slides to `translateX(-W)` (centre visible) over ~200ms via
	 *  the executor's rAF, matching the non-pilot routes' CSS
	 *  `duration-200`. No navigation is dispatched on settle (the
	 *  route has already landed). */
	playEnterAnimation(): void {
		const inputs = this.#mountInputs;
		const executor = this.#executor;
		if (inputs === null || executor === null) return;
		const w = inputs.viewportWidth;
		if (w <= 0) return;
		const plan: TransitionPlan = {
			pageTrack: {
				axis: 'left',
				distance: w,
				restingTranslate: 0
			},
			fab: () => ({ scale: 0, translateY: 0, visible: false }),
			header: () => ({ morph: 0, titleCrossfade: 0, translateY: 0 }),
			progressDirection: 0,
			commitPhysics: 'momentum'
		};
		this.#pendingGesture = null;
		this.#pendingTabExit = null;
		this.#isEnterAnimation = true;
		this.#publication = {
			plan,
			progress: 0,
			inFlight: true,
			fromPathname: inputs.backTarget,
			toPathname: inputs.fromPathname,
			direction: 'forward',
			chipExit: false
		};
		executor.onDragStart(plan, 0, 0);
		executor.onCommit(0, TAB_CLICK_COMMIT_MS);
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
		this.#publication = AT_REST_PUBLICATION;
		this.#lifecycle.deactivate();
		this.#lifecycle.unmount();
	}

	/** Register a teardown that runs once when the host unmounts in the
	 *  browser (SSR-safe). The host migrates the html-singleton releases
	 *  (`viewport-lock.release`, `clearActiveGestureTrack`,
	 *  `scrollChrome.releaseContainer`) onto this so the lifecycle
	 *  controller is the single teardown path. */
	registerTeardown(fn: VoidHandler): void {
		this.#lifecycle.registerTeardown(fn);
	}

	// -----------------------------------------------------------------------
	// Pointer events -> intent -> orchestrator.

	private forwardEvent(kind: IntentEventKind, x: number, y: number, target: string | null): void {
		if (this.#mountInputs === null) return;
		const event: IntentEvent = { kind, x, y, t: this.#clock(), target };
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
	onPointerDown(x: number, y: number, target: string | null): void {
		this.forwardEvent('pointerdown', x, y, target);
	}

	/** A pointermove arrived (only fires once the gesture is claimed). */
	onPointerMove(x: number, y: number): void {
		this.forwardEvent('pointermove', x, y, null);
	}

	/** A pointerup arrived. When `velocity` and `reversed` are provided
	 *  (from `detectSwipe`'s `EndHandler`), they override the
	 *  classifier's own estimates: detectSwipe's rebound-based
	 *  `reversed` (peak minus final, with a forward-fling gate) and
	 *  trailing-window `velocity` are the authoritative release
	 *  signals, matching the non-pilot routes' commit/cancel decision. */
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
		this.#interpretIntent();
	}

	/** A pointercancel arrived. */
	onPointerCancel(x: number, y: number): void {
		this.forwardEvent('pointercancel', x, y, null);
	}

	/** Interpret the latest intent state and feed the orchestrator +
	 *  executor. Runs on every event so the drag tracks 1:1. */
	#interpretIntent(): void {
		const inputs = this.#mountInputs;
		const executor = this.#executor;
		if (inputs === null || executor === null) return;
		const intent = this.#intent;
		// Deciding / idle: nothing to do.
		if (intent.micro === 'idle' || intent.micro === 'deciding') {
			return;
		}
		// A drag just started (micro first flipped to drag-left / drag-right).
		// Lock FROM / TO and run the resolver once.
		let gestureJustStarted = false;
		if (
			this.#pendingGesture === null &&
			(intent.micro === 'drag-left' || intent.micro === 'drag-right')
		) {
			this.#beginGesture(inputs, intent);
			gestureJustStarted = true;
		}
		// During a drag (and after a release while we wait for settle),
		// stream the live progress to the executor. The TRACK sees the
		// threshold-absorbed progress (so it stays at rest for the first
		// 20% of drag); the FAB / Header consumers see the RAW drag
		// fraction (their consumer-side thresholds apply separately). Skip the
		// first onDragMove on the same event that started the gesture:
		// #beginGesture already published the initial frame (with the
		// startProgress for enter-interrupt), and the live finger offset at
		// claim time (~10px dead zone) would compute trackProgress=0,
		// overriding the startProgress and snapping the track.
		if (this.#pendingGesture !== null && this.#publication.plan !== null && !gestureJustStarted) {
			const raw = this.#rawDragFraction(intent, inputs);
			const trackProgress = this.#thresholdAbsorbedProgress(raw);
			executor.onDragMove(trackProgress, intent.offset);
			this.#publish(raw);
		}
		// Released: apply the commit-vs-cancel gate.
		// The orchestrator resolves the plan ONCE at gesture start
		// (progressDirection=0, commit). At release the orchestrator
		// decides commit vs cancel based on drag distance + the
		// rebound-based `reversed` signal forwarded from detectSwipe
		// (the same source the non-pilot routes use): commit iff
		// `dragDistance >= SWIPE_COMMIT && !reversed`.
		if (intent.micro === 'committed' || intent.micro === 'cancelled') {
			this.#liveDragging = false;
			if (this.#pendingGesture !== null) {
				const dragDistance = Math.abs(intent.offset);
				const reversed = intent.reversed;
				const shouldCommit = dragDistance >= SWIPE_COMMIT && !reversed;
				if (shouldCommit) {
					executor.onCommit(intent.releaseVelocity);
				} else {
					executor.onCancel(intent.releaseVelocity);
				}
			}
			this.#intent = initialIntentState();
			return;
		}
	}

	/** Map the live drag offset to the RAW drag fraction in [0, 1].
	 *  0 at rest; 1 at a full viewport-width drag. Published to the
	 *  pager store so the existing FAB layer (Family B reader of
	 *  `coverProgress`) and Header layer (reader of `backMorph`) react
	 *  to the orchestrator's state. */
	#rawDragFraction(intent: IntentState, inputs: PipelineMountInputs): number {
		const w = inputs.viewportWidth;
		if (w <= 0) return 0;
		// The back-swipe (drag-right) is the only gesture direction the
		// pilot listens for: the TO is `/messages/inbox`, revealed by a
		// rightward drag.
		const offsetX = intent.direction === 'right' ? Math.max(0, intent.offset) : 0;
		return Math.max(0, Math.min(1, offsetX / w));
	}

	/** Map the RAW drag fraction to the threshold-absorbed progress the
	 *  executor uses for the TRACK translate. The first 20% of the
	 *  drag is absorbed (the track stays at rest); above 20% the drag
	 *  maps 1:1 onto the remaining [0, 1] window. */
	#thresholdAbsorbedProgress(raw: number): number {
		const THRESHOLD = 0.2;
		if (raw <= THRESHOLD) return 0;
		return Math.max(0, Math.min(1, (raw - THRESHOLD) / (1 - THRESHOLD)));
	}

	/** Lock FROM/TO and run the resolver + coordinator once. */
	#beginGesture(inputs: PipelineMountInputs, intent: IntentState): void {
		// Only a rightward back-swipe is a real gesture on the pilot.
		// Check direction BEFORE mutating any state so a non-claimed
		// leftward drag does not leak #isEnterAnimation/#liveDragging
		// (which would corrupt the forward-enter's publication).
		if (intent.direction !== 'right') {
			this.#pendingGesture = null;
			return;
		}
		// Capture the enter state BEFORE clearing it so the
		// progress-matching logic can compute the equivalent start
		// position (the enter slides 0 to -W at progress 0 to 1; the
		// back-swipe slides -W to 0 at progress 0 to 1; so
		// gestureProgress = 1 - enterProgress).
		const wasEnter = this.#isEnterAnimation;
		this.#isEnterAnimation = false;
		this.#liveDragging = true;
		const from = inputs.fromPathname;
		const fromTag = inputs.fromTag;
		const to = inputs.backTarget;
		const toTag = inputs.toTag;
		const direction: TransitionDirection = 'backward';
		this.#pendingGesture = { from, fromTag, to, toTag, direction };
		const plan = this.#resolvePlan(inputs, intent, direction, to, toTag, inputs.toTabIndex);
		// Coordinator: direct-slide if the TO is cached; chip-exit + preload otherwise.
		const cacheHas = (pathname: string, _subKey?: string): boolean => {
			const cache = getPageCacheStore();
			return cache.get(pathname, _subKey) !== null;
		};
		const decision = coordinate({
			fromPathname: from,
			toPathname: to,
			toSubKey: undefined,
			toSnapshotCapture: getRouteData(to).snapshotCapture,
			cacheHas,
			hasToSnippet: false
		});
		const chipExit = decision.strategy === 'chip-exit';
		this.#stateMachine.onIntent(intent, from, fromTag);
		this.#stateMachine.onResolved(plan, from, to, fromTag, toTag, direction);
		this.#publication = {
			plan,
			progress: 0,
			inFlight: true,
			fromPathname: from,
			toPathname: to,
			direction,
			chipExit
		};
		this.#chipExitState = chipExit;
		// When interrupting a forward-enter, compute the equivalent
		// progress so the track does not jump (the enter and back-swipe
		// plans have mirrored geometry; gestureProgress = 1 - enterProgress).
		let startProgress = 0;
		if (wasEnter) {
			startProgress = 1 - (this.#executor?.state.progress ?? 0);
		}
		this.#executor?.onDragStart(plan, startProgress, intent.offset);
	}

	/** Resolve a transition plan for the locked FROM/TO/direction. */
	#resolvePlan(
		inputs: PipelineMountInputs,
		intent: IntentState,
		direction: TransitionDirection,
		toPathname: string,
		toTag: RouteTag,
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
		// Apply the multi-panel resting translate and slide distance so
		// progress 0 -> 1 maps the track from `-W` (centre fills the
		// viewport, left section off-screen) to `0` (left section fills
		// the viewport, centre off-screen). The track is `2 * W` wide
		// (panelCount=2); the centre panel is the right half (track
		// offset W..2W), so translateX=-W puts the centre at viewport
		// 0..W (fills it) and the left at viewport -W..0 (off-screen).
		return {
			...plan,
			pageTrack: {
				axis: plan.pageTrack.axis,
				distance: inputs.viewportWidth,
				restingTranslate: inputs.restingTranslate
			}
		};
	}

	// -----------------------------------------------------------------------
	// Settle: dispatch the navigation on a commit; land on a cancel.

	/** Per-frame callback fired by the executor after each commit rAF
	 *  sample. Converts the executor's threshold-absorbed progress
	 *  back to the raw drag-fraction scale the live-drag path uses,
	 *  so `coverProgress` / `backMorph` / `fractionalIndex` are
	 *  continuous across the drag-to-commit boundary (no FAB-scale
	 *  reversal at commit start). */
	#onExecutorTick(progress: number): void {
		if (this.#publication.plan === null) return;
		// Skip the first tick when progress is still 0 (the commit hasn't
		// started integrating). This happens for sub-morph-threshold
		// releases (drag 60-78px, raw < 0.2, threshold-absorbed progress
		// clamped to 0). Without this guard, #thresholdToRaw(0) returns 0,
		// causing coverProgress to dip from the last live-drag raw (~0.15)
		// to 0, then jump back up on the next tick. Skipping keeps the
		// last live-drag publish until the executor's progress is > 0.
		if (progress <= 0) return;
		const raw = this.#thresholdToRaw(progress);
		this.#publish(raw);
	}

	/** Reverse the threshold-absorbed progress mapping so the commit
	 *  phase publishes on the same raw scale as the live-drag phase.
	 *  Forward: `threshold = (raw - 0.2) / 0.8` (for raw > 0.2).
	 *  Reverse: `raw = 0.2 + 0.8 * threshold` (for threshold > 0);
	 *  `raw = 0` for threshold <= 0 (cancel end, FAB fully retracted). */
	#thresholdToRaw(thresholdProgress: number): number {
		const THRESHOLD = 0.2;
		if (thresholdProgress <= 0) return 0;
		return THRESHOLD + (1 - THRESHOLD) * thresholdProgress;
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
		// pilot route unmounts during the navigation). For the `goto`
		// path, `goto`'s promise resolves after the navigation lands
		// so the `.finally` cleanup is safe; the `history.back` /
		// `history.forward` paths have no promise to await, so they
		// rely on the lifecycle hooks to clear.
		if (hop === 'back') {
			history.back();
		} else if (hop === 'forward') {
			history.forward();
		} else {
			void goto(target, { replaceState: false }).finally(() => {
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
		this.#executor?.onLand();
		if (inputs !== null) {
			this.#stateMachine.onLand(inputs.fromTag);
		}
		this.#publication = AT_REST_PUBLICATION;
		this.#chipExitState = false;
	}

	// -----------------------------------------------------------------------
	// SvelteKit interop.

	/** Called from `+layout.svelte`'s `beforeNavigate` for pilot-route
	 *  sources / destinations. Returns true if the orchestrator
	 *  consumed the navigation (cancelled + started a slide plan); the
	 *  layout hook does NOT also call the root layout's
	 *  `navStore.handleBeforeNavigate` in that case. */
	onSvelteKitBeforeNavigate(navigation: PilotBeforeNavigateEvent): boolean {
		const inputs = this.#mountInputs;
		if (inputs === null) return false;
		const from = navigation.from?.url.pathname ?? null;
		const to = navigation.to?.url.pathname ?? null;
		// The orchestrator's own dispatch (goto / history.back /
		// history.forward) re-entering beforeNavigate. Two checks: the
		// in-flight flag (set at dispatch time) and a target match
		// (catches the re-entry across timer / popstate ordering so
		// the orchestrator never re-cancels its own nav).
		if (this.#navDispatchInFlight) {
			return false;
		}
		if (this.#dispatchTarget !== null && to === this.#dispatchTarget) {
			return false;
		}
		// Only own transitions FROM the pilot route (a tab-click exit or
		// a back-swipe equivalent). Transitions TO the pilot route
		// (deep-link landings) fall through; the afterNavigate hook
		// clears the state.
		if (from === null || !this.#isPilotFrom(inputs, from)) {
			return false;
		}
		if (to === null) return false;
		// Let the root layout hooks handle the navigation if the target
		// is also the pilot route (e.g. a paged conversation step within
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
		// A tab-click exit (or any other pilot -> non-pilot nav). Drive
		// the slide plan via the executor and dispatch on settle.
		const toPathname = to;
		const toTag = getRouteData(toPathname).tag;
		const toTabIndex = this.#tabIndexFor(toPathname);
		const direction: TransitionDirection = isTabRootPath(toPathname) ? 'backward' : 'forward';
		// Synthesize a "tap" intent so the resolver produces a commit plan.
		const intent = {
			...initialIntentState(),
			micro: 'committed' as const,
			target: toPathname,
			startedAt: this.#clock()
		};
		const plan = this.#resolvePlan(inputs, intent, direction, toPathname, toTag, toTabIndex);
		// Chip-exit when the target is a tab root that is NOT the
		// pre-rendered leftHref (the pilot only pre-renders /messages/inbox).
		const chipExit = isTabRootPath(toPathname) && toPathname !== inputs.backTarget;
		// Capture the in-flight state BEFORE clearing / reassigning, so
		// the progress-matching logic below can detect a prior transition.
		const wasEnterAnimation = this.#isEnterAnimation;
		const hadInFlightTransition = this.#publication.inFlight && this.#publication.plan !== null;
		this.#pendingGesture = null;
		this.#pendingTabExit = { target: to, svelteKitType: navigation.type, chipExit };
		this.#navDispatchInFlight = false;
		this.#dispatchTarget = null;
		this.#isEnterAnimation = false;
		navigation.cancel();
		this.#publication = {
			plan,
			progress: 0,
			inFlight: true,
			fromPathname: inputs.fromPathname,
			toPathname,
			direction,
			chipExit
		};
		this.#chipExitState = chipExit;
		// Drive the executor: dragStart, then commit with an explicit
		// duration (`TAB_CLICK_COMMIT_MS`) matching the non-pilot
		// routes' CSS `duration-200`. A tab-click is a discrete nav,
		// not a finger release; the explicit duration keeps the pilot's
		// exit animation consistent with the non-pilot routes' tab-exit.
		// When interrupting a forward-enter, compute the equivalent
		// progress in the tab-click plan that matches the current visual
		// position (the enter slides 0 to -W at progress 0 to 1; the
		// tab-click slides -W to 0 at progress 0 to 1; so
		// tabProgress = 1 - enterProgress). When interrupting a gesture
		// commit, read the executor's progress directly (the back-swipe
		// and tab-exit plans share geometry; no inversion needed).
		let startProgress = 0;
		if (wasEnterAnimation) {
			const enterProgress = this.#executor?.state.progress ?? 0;
			startProgress = 1 - enterProgress;
		} else if (hadInFlightTransition) {
			startProgress = this.#executor?.state.progress ?? 0;
		}
		this.#executor?.onDragStart(plan, startProgress, 0);
		this.#executor?.onCommit(0, TAB_CLICK_COMMIT_MS);
		return true;
	}

	/** Called from `+layout.svelte`'s `afterNavigate` for pilot-route
	 *  sources / destinations. Clears the orchestrator's state. */
	onSvelteKitAfterNavigate(): void {
		this.#landAtRest();
	}

	#isPilotFrom(inputs: PipelineMountInputs, from: string): boolean {
		// The pilot's own pathname. Compare by prefix so a paged URL
		// (`/messages/123/p2`) still counts as the pilot.
		const pilotPath = inputs.fromPathname.replace(/\/p\d+$/, '');
		const fromStripped = from.replace(/\/p\d+$/, '');
		return pilotPath === fromStripped;
	}

	#tabIndexFor(pathname: string): number {
		// The fromTabIndex for the TO field; the resolver uses this
		// only for {tab, tab} pairs (not relevant for the pilot's
		// detail -> tab back-swipe). Default to -1 when not a tab root.
		if (!isTabRootPath(pathname)) return -1;
		const tabs = ['/', '/activity', '/messages/inbox'];
		const idx = tabs.indexOf(pathname);
		return idx >= 0 ? idx : -1;
	}

	// -----------------------------------------------------------------------
	// Reactive publication to the pager store.

	/** Reset the pager store to the at-rest publication. The host calls
	 *  this from a `$effect` when the orchestrator's plan transitions
	 *  back to null (no transition in flight). */
	resetPagerStore(): void {
		const pager = getMobilePagerStore();
		const inputs = this.#mountInputs;
		const centerTab = inputs?.centerTab;
		pager.set({
			fractionalIndex: centerTab ?? inputs?.fromTabIndex ?? -1,
			dragging: false,
			active: false,
			backMorph: centerTab !== undefined ? null : 0,
			targetIndex: null,
			coverProgress: 0
		});
	}

	/** Internal: refresh the publication's progress and re-publish to
	 *  the pager store. Called from two paths, both passing a RAW drag
	 *  fraction on the same scale: (1) the live-drag path
	 *  (`#interpretIntent`) passes `offsetX / W` directly; (2) the
	 *  commit path (`#onExecutorTick`) converts the executor's
	 *  threshold-absorbed progress back to raw via
	 *  `#thresholdToRaw` before calling this. Both values drive
	 *  `coverProgress` / `backMorph` / `fractionalIndex` via
	 *  `#republishToPager`. The host's `$effect` only handles the
	 *  at-rest reset (when `publication.plan` becomes null); the
	 *  in-flight publication is the orchestrator's responsibility. */
	#publish(rawDragFraction: number): void {
		const current = this.#publication;
		if (current.plan === null) return;
		this.#publication = { ...current, progress: rawDragFraction };
		this.#republishToPager(rawDragFraction);
	}

	/** Republish the current publication to the pager store. In
	 *  centerTab mode (pilot route), publishes `backMorph: null,
	 *  targetIndex: null, fractionalIndex: centerTab` (constant) so
	 *  the Header stays in back-arrow mode and the tab-bar pill stays
	 *  highlighted at centerTab throughout the gesture, matching GPL's
	 *  centerTab branch. `coverProgress` follows the raw drag fraction
	 *  during a live gesture, but is forced to 0 during chip-exit
	 *  (LoadingChip stands in for the source list) and during the
	 *  forward-enter animation (the source list is being covered, not
	 *  revealed). */
	#republishToPager(rawDragFraction: number): void {
		const pager = getMobilePagerStore();
		const publication = this.#publication;
		const plan = publication.plan;
		if (plan === null) {
			return;
		}
		const inputs = this.#mountInputs;
		const centerTab = inputs?.centerTab;
		const coverProgress = publication.chipExit || this.#isEnterAnimation ? 0 : rawDragFraction;
		if (centerTab !== undefined) {
			pager.set({
				fractionalIndex: centerTab,
				dragging: publication.inFlight && this.#liveDragging && !publication.chipExit,
				active: true,
				backMorph: null,
				targetIndex: null,
				coverProgress
			});
			return;
		}
		const fromIdx = inputs?.fromTabIndex ?? -1;
		const toIdx = inputs?.toTabIndex ?? -1;
		const fractionalIndex = fromIdx + (toIdx - fromIdx) * rawDragFraction;
		pager.set({
			fractionalIndex,
			dragging: publication.inFlight && !publication.chipExit,
			active: true,
			backMorph: rawDragFraction,
			targetIndex: toIdx >= 0 ? toIdx : null,
			coverProgress
		});
	}
}

/** The module singleton. The host constructs a fresh orchestrator on
 *  each pilot mount and assigns it via `setNavPipelineOrchestrator`;
 *  `+layout.svelte` reads it via `getNavPipelineOrchestrator` so the
 *  SvelteKit nav hooks reach the active orchestrator. */
let active: NavPipelineOrchestrator | null = null;

/** Get the active orchestrator (or null if the pilot is not mounted). */
export function getNavPipelineOrchestrator(): NavPipelineOrchestrator | null {
	return active;
}

/** Set the active orchestrator. Called by `NavPipelineHost.onMount`. */
export function setNavPipelineOrchestrator(orch: NavPipelineOrchestrator | null): void {
	if (active !== null && active !== orch) {
		active.unmount();
	}
	active = orch;
}

/** Test-only: clear the singleton. */
export function __resetNavPipelineOrchestrator(): void {
	active = null;
}

export { NO_OP_PLAN };
