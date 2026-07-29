// src/lib/stores/nav-pipeline-orchestrator.svelte.ts
/**
 * The universal pipeline orchestrator for every mobile route. Owns the
 * four integration points the DV20 spec requires:
 *
 *   1. SvelteKit nav -> orchestrator: `onSvelteKitBeforeNavigate` /
 *      `onSvelteKitAfterNavigate` (called from `src/routes/+layout.svelte`'s
 *      hooks; `beforeNavigate` gated by
 *      `isPipelineTransition && orchestrator !== null`, `afterNavigate`
 *      gated by `orchestrator !== null`).
 *   2. Pointer -> intent: `onPointerDown` / `onPointerMove` /
 *      `onPointerUp` (called from the `navPipelinePointer` Svelte
 *      action that wraps `detectSwipe`; a `pointercancel` is routed by
 *      `detectSwipe` through its onUp listener and reaches the
 *      orchestrator as `onPointerUp` with the cancel signal forced by
 *      `shouldCancelOnRelease`, so a system-interrupted gesture never
 *      commits).
 *   3. Executor + driver -> elements: `configure({ resolveElements, ... })`
 *      constructs (once) a `LiveNavDomDriver` whose `resolveElements` returns
 *      `{ pageTrack: trackEl }` - the FAB and Header are reactive readers
 *      of the pager store / orchestrator publication; the executor never
 *      writes to them. The executor writes the per-frame track translate
 *      to the resolved `pageTrack` element.
 *   4. Lifecycle: the host calls `configure` / `releaseInputs` from its
 *      onMount / onDestroy and releases the html-singletons (viewport-lock)
 *      directly with a `browser` guard. Route swaps use `configure` /
 *      `releaseInputs` (no executor / driver / rAF teardown); the mobile
 *      -> desktop flip uses the full `unmount` teardown (app exit
 *      abandons the singleton to the browser; no teardown runs).
 *
 * Per the DV20 spec's binding "UNIFY, DO NOT BRIDGE" constraint: this
 * orchestrator is the SOLE transition mechanism for EVERY transition
 * type on EVERY mobile route. No `gestureSource` selector; no intent
 * mirror into the host component's `$state`; no CSS-transition +
 * `transitionend` path. Every mobile route mounts `NavPipelineHost` (the
 * thread, compose, and deep-page routes) or `NavPipelineTabHost` (the
 * three tab roots); the shared singleton orchestrator drives every
 * transition through the executor.
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
 * calls the full `unmount()` teardown; app exit abandons the singleton to
 * the browser (no teardown runs).
 *
 * Per DV20 §13.5 the `NavStateMachine` is the sole authority for the
 * macro transition state (phase, plan, FROM/TO, direction). The
 * orchestrator dispatches `intent` / `resolved` / `land` events into
 * the state machine and reads its publication as a `$derived` that
 * merges the state machine's macro fields with the orchestrator's
 * per-frame `#progress` (synchronous per pointermove during a drag,
 * via the executor's rAF during a commit/cancel slide). The
 * orchestrator does not hold an independent publication `$state`.
 */

import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { getMobilePagerStore } from '$lib/stores/mobile-pager.svelte';
import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
import { getNavStateMachine } from '$lib/stores/nav-state-machine.svelte';
import { getNavigationStore } from '$lib/stores/navigation.svelte';
import { atRestOnFor } from '$lib/stores/nav-state-machine-logic';
import { NavExecutor } from '$lib/stores/nav-executor.svelte';
import {
	commitEase,
	progressAtTranslateX,
	settlePerTickCap,
	trackTranslateX
} from '$lib/utils/nav-executor-logic';
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
import { getCurrentTabIndex } from '$lib/utils/route-config';
import { hopForHref, isTabRootPath, previousEntryPathname } from '$lib/utils/history-nav';
import { isNavPipelineRoute } from '$lib/utils/nav-pipeline-gate';
import { resolveHeaderMode } from '$lib/utils/header-mode';
import {
	HEADER_MORPH_THRESHOLD,
	PILL_EXPANSION_THRESHOLD,
	SWIPE_COMMIT,
	BOUNDARY_RUBBER_BAND_FACTOR,
	TITLE_CROSSFADE_MS
} from '$lib/utils/gesture-constants';
import { resolveDeepHeaderTitle } from '$lib/utils/deep-header-config';
import { computeFabScale } from '$lib/utils/fab-scale';
import type {
	DragFabAnchor,
	DragMorphAnchor,
	EnterFabAnchor,
	HeaderSettleTransition,
	SearchAnchor
} from '$lib/utils/header-probe';
import type { TranslationDict } from '$lib/types/translation';
import type { RouteTag } from '$lib/utils/route-data';
import type { TransitionPlan } from '$lib/utils/nav-resolvers';

/** The host's track element ref as supplied to the driver each
 *  `write`. Mirrors the structural shape of `LiveDriverElements` but
 *  widened to the production `HTMLElement` (the driver's own interface
 *  accepts a structural `DriverElement` subset). */
interface PipelineElementRefs {
	readonly pageTrack: HTMLElement | null;
}

/** Returns the host's track element ref each `write`. Called once per
 *  frame so a re-bound `bind:this` is picked up automatically. */
type PipelineElementResolver = () => PipelineElementRefs;

/** A pending gesture transition (a swipe). `to` is the
 *  commit-settle dispatch target; `startProgress` is the track's
 *  progress at gesture start, read by the live-drag loop to continue
 *  from the current visual position (no snap back to 0). */
interface PendingGestureTransition {
	readonly to: string;
	readonly startProgress: number;
	/** The raw drag fraction at gesture start (the commit's last
	 *  published raw for a re-grab, 0 for from-rest). The live-drag's
	 *  published progress starts from here so the slide (and the FAB
	 *  scale, derived from this progress via `computeFabScale`) does
	 *  not jump on a re-grab. */
	readonly rawStart: number;
	/** The gesture's transition direction. 'backward' = rightward
	 *  (toward the previous tab / back-target); 'forward' = leftward
	 *  (toward the next tab, bidirectional hosts only). Determines the
	 *  commit-threshold sign at release. */
	readonly direction: TransitionDirection;
	/** True when the gesture targets an absent neighbour (the first tab
	 *  with no previous history entry on a bidirectional host). The track
	 *  follows the finger at `BOUNDARY_RUBBER_BAND_FACTOR` and always
	 *  cancels on release (no navigation dispatched). */
	readonly boundary: boolean;
}

/** A pending discrete navigation the orchestrator cancelled in
 *  `onSvelteKitBeforeNavigate`: either a tab-click exit (a host-route
 *  -> tab-root nav) or a deep-to-deep nav intercepted on the source
 *  host. Carries the deferred dispatch target (the FULL url: pathname
 *  + search) so commit-settle can fire the SvelteKit `goto` on the
 *  exact URL the discrete nav targeted. */
interface PendingDiscreteNav {
	readonly target: string;
	/** The `replaceState` intent captured from the pager store at queue
	 *  time, carried through the finish-then-new replay so a
	 *  `Header.onBack` replace-intent nav queued during an in-flight
	 *  commit does not silently degrade to a push. The capture-clear-rearm
	 *  flow: the finish-then-new branch reads the store into this field
	 *  AND clears the store so the in-flight commit's subsequent
	 *  `#dispatchNav(commitTarget)` (whose target is the COMMIT's, not the
	 *  queued nav's) does not mis-apply the intent to the wrong target;
	 *  `#landAtRest` then re-arms the store from this field before firing
	 *  the replay goto so the replay's `#dispatchNav` (which reads the
	 *  store, not the queue) picks up the correct intent. Optional:
	 *  `#pendingDiscreteNav` does not set it (its dispatch reads the store
	 *  directly); only `#queuedDiscreteNav` sets it. */
	readonly replaceState?: boolean;
}

/** A URL record subset the layout hook extracts from SvelteKit's
 *  navigation event. Defined here so the orchestrator does not depend
 *  on the SvelteKit navigation type directly. */
interface NavPipelineUrl {
	readonly pathname: string;
	readonly search: string;
}

/** A `from`/`to` endpoint carried by `NavPipelineBeforeNavigateEvent`. */
interface NavPipelineEndpoint {
	readonly url: NavPipelineUrl;
}

/** SvelteKit's navigation-cancel hook. */
type NavPipelineCancelFn = () => void;

/** The subset of the SvelteKit `BeforeNavigate` event the orchestrator
 *  reads. Defined here so the orchestrator does not depend on the
 *  SvelteKit navigation type directly (the layout hook adapts). */
interface NavPipelineBeforeNavigateEvent {
	readonly from: NavPipelineEndpoint | null;
	readonly to: NavPipelineEndpoint | null;
	readonly type: string;
	readonly cancel: NavPipelineCancelFn;
}

/** The current viewport width (px). The host reads `window.innerWidth` /
 *  the bound element's `clientWidth` and supplies it; the orchestrator
 *  does not read the DOM directly. */
export interface PipelineMountInputs {
	/** Returns the host's track element ref each `write`. Called once
	 *  per frame so a re-bound `bind:this` is picked up automatically. */
	readonly resolveElements: PipelineElementResolver;
	/** The current viewport width (px). */
	readonly viewportWidth: number;
	/** The multi-panel track's resting translate (px) at progress=0.
	 *  For the 3-panel `NavPipelineHost` track (LEFT=back-target,
	 *  CENTER=current, RIGHT=forward deep-to-deep destination) this is
	 *  `-viewportWidth` so the centre panel (the middle third of the
	 *  3*W track) fills the viewport, with LEFT off-screen left and
	 *  RIGHT off-screen right. For the 3-panel bidirectional host
	 *  (`NavPipelineTabHost`) this is `-activeIndex * viewportWidth`.
	 *  The plan's `pageTrack.restingTranslate` field carries this into
	 *  the executor's `buildVisual`. */
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
	 *  orchestrator publishes a live `backMorph: rawDragFraction` (the same
	 *  gesture-feedback signal the deep-page path publishes) plus a
	 *  `fractionalIndex` that interpolates from `centerTab` toward the
	 *  gesture's resolved destination tab, so the Header's morph derivation
	 *  and the tab-bar pill both track the finger during a drag (gesture
	 *  feedback: the morph eases toward the back-arrow as the swipe
	 *  advances, then the settle ease armed at release returns the morph to
	 *  the destination's tab-ness via the captured `startMorph`). At rest
	 *  the publication holds `fractionalIndex: centerTab`,
	 *  `targetIndex: null`, `backMorph: null` so the Header's morph
	 *  derivation falls through to the at-rest branch
	 *  (`currentHasTabs ? 1 : 0`). The thread route is tab-associated
	 *  (`getCurrentTabIndex('/messages/<id>') === 2`, so
	 *  `currentHasTabs === true`), morph rests at 1 (tab bar visible,
	 *  hamburger icon) and the published `fractionalIndex = centerTab`
	 *  matches the tab the thread overlays. When undefined, the deep-page
	 *  / tab-host publication paths apply (compose route, deep page, or
	 *  tab host). */
	readonly centerTab?: number;
	/** When true the orchestrator claims BOTH rightward and leftward
	 *  drags (`NavPipelineTabHost`, the three tab roots). Rightward
	 *  targets the back-target (previous tab); leftward targets the
	 *  next tab. When false or undefined, only rightward back-swipes
	 *  are claimed (`NavPipelineHost`, the thread, compose, and
	 *  deep-page routes). */
	readonly bidirectional?: boolean;
}

/** The orchestrator's published reactive state for downstream
 *  consumers. The FAB layer reads this publication directly; the
 *  orchestrator publishes the in-flight pager fields via
 *  `#republishToPager` (a host calls only `resetPagerStore` for the
 *  at-rest reset). The Header reads the macro morph / FROM-TO fields
 *  (`backMorph`, `tapMorph`, `transitionTarget`) via the pager store,
 *  and reads only the settle / scrub fields directly off this
 *  orchestrator singleton. Per DV20 §13.5 the NavStateMachine is the sole
 *  authority for the macro fields (plan, FROM/TO, direction, in-flight)
 *  and the settle + tap-scrub micro animation state; `progress` is the
 *  orchestrator's per-frame contribution (synchronous per pointermove
 *  during a drag, via the executor's rAF during a commit/cancel slide).
 *  `lastDispatchWasDeepToDeep` is the
 *  cross-host deep-to-deep handshake flag carried in the publication
 *  so the destination host's `shouldEnter` reads it on the other side
 *  of `releaseInputs` / `configure` (it survives the host swap to
 *  carry the source host's dispatch fact to the destination host). */
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
	/** The settle progress on the publication's raw scale. The rAF-tick
	 *  value the state machine owns; runs from `settleStartProgress` to
	 *  `settleTargetProgress` across the eased curve. The title crossfade
	 *  reads this directly (the span positions are continuous with the
	 *  live-drag `pager.backMorph` value because both share the raw
	 *  scale). The morph derivation reads `settleMorphFraction` instead:
	 *  the morph must interpolate from the drag's terminal value
	 *  (captured in `settleLatched.startMorph`) to
	 *  `settleLatched.destMorph`, a different [0, 1] window than the raw
	 *  `settleProgress` for a gesture-release settle, and on a saturated
	 *  commit (`settleStartProgress === settleTargetProgress === 1`) the
	 *  raw-scale window has zero span, so the morph follows the rAF's
	 *  eased timeline directly. */
	readonly settleProgress: number;
	/** The settle progress's start value on the publication's raw scale
	 *  (the release raw for a gesture-release settle, 0 for a non-gesture
	 *  arm). The rAF advances `settleProgress` from this value toward
	 *  `settleTargetProgress`. */
	readonly settleStartProgress: number;
	/** The settle progress's terminal value on the publication's raw
	 *  scale (1 for a commit / click, 0 for a cancel). */
	readonly settleTargetProgress: 0 | 1;
	/** The settle rAF's eased timeline fraction (0 at arm, 1 at duration
	 *  end). The Header's morph derivation reads this to interpolate
	 *  `settleLatched.startMorph` to `settleLatched.destMorph` across the
	 *  settle so the morph stays continuous across the drag-to-settle
	 *  handoff for every gesture shape and every commit saturation
	 *  (DV21 §5). */
	readonly settleMorphFraction: number;
	/** The latched endpoint identity of the in-flight settle. null at rest. */
	readonly settleLatched: HeaderSettleTransition | null;
	/** The direction of the in-flight settle (forward / back). */
	readonly settleDirection: 'forward' | 'back';
	/** True while a commit settle holds at progress 1 awaiting the
	 *  navigation to land. */
	readonly settleAwaitTitle: boolean;
	/** True while the tap-scrub ease is in flight. */
	readonly searchScrubbing: boolean;
	/** True when the most recent dispatch was a deep-to-deep
	 *  interception. Read by the destination host's `shouldEnter` to
	 *  suppress `playEnterAnimation` (the orchestrator already animated
	 *  the slide on the source host). See `#lastDispatchWasDeepToDeep`. */
	readonly lastDispatchWasDeepToDeep: boolean;
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
		pageTrack: null
	});
	// True between configure() and releaseInputs(). Guards #publication
	// so the derived returns at-rest during the gap frame between an old
	// host's releaseInputs and the new host's configure, instead of
	// publishing the prior route's transition state to the persistent
	// FAB / Header consumers.
	#mounted = $state(false);
	/** A pending swipe gesture (backward or forward). `to` is the
	 *  commit-settle dispatch target; `startProgress` is the track's
	 *  progress at gesture start, read by the live-drag loop. Null at
	 *  rest and after settle. */
	#pendingGesture: PendingGestureTransition | null = null;
	/** A pending discrete nav (tab-click exit or deep-to-deep) the
	 *  orchestrator cancelled; `target` is the dispatch target fired on
	 *  commit-settle. Null at rest. */
	#pendingDiscreteNav: PendingDiscreteNav | null = null;
	/** A queued discrete navigation (tab-click or deep-to-deep) that
	 *  arrived while a commit slide was in flight. The orchestrator
	 *  accelerated the in-flight commit to completion; when the commit
	 *  settles, dispatches its own nav, and the nav lands, `#landAtRest`
	 *  fires this queued goto so `onSvelteKitBeforeNavigate` intercepts
	 *  it on the landed host and plays the transition from progress 0
	 *  (the finish-then-new interruption policy). Null when no discrete
	 *  nav is queued. */
	#queuedDiscreteNav: PendingDiscreteNav | null = null;
	/** True while the forward-enter animation (playEnterAnimation) is
	 *  active. The afterNavigate guard and the resize guard read it to
	 *  avoid landing the orchestrator or mutating the plan mid-enter. */
	#isEnterAnimation = false;
	/** True during the live-drag phase of ANY gesture (backward or
	 *  forward, on bidirectional hosts). The classifier locks micro to
	 *  'drag-right' or 'drag-left' depending on direction once the
	 *  gesture is claimed, so a mid-gesture reversal (finger reverses
	 *  within the claimed gesture) stays live-dragging; the flag clears
	 *  on release (committed / cancelled). Controls the pager store's
	 *  `dragging` field, republished each frame as
	 *  `publication.inFlight && #liveDragging`: true during live drag
	 *  only, NOT during the commit slide. */
	#liveDragging = false;
	/** True when the orchestrator's own dispatch (`goto` /
	 *  `history.back()` / `history.forward()`) has fired and is
	 *  re-entering beforeNavigate. Lets the orchestrator's
	 *  beforeNavigate handler pass it through. */
	#navDispatchInFlight = $state(false);
	/** The most recent dispatch's target: the gesture target's pathname
	 *  (`pendingGesture.to`) or the discrete nav's full URL
	 *  (`pendingDiscreteNav.target`, pathname + search). The pass-through
	 *  check in `onSvelteKitBeforeNavigate` (`#isOwnDispatchReentry`)
	 *  matches the nav's `to` against this, accepting either form, to catch
	 *  the orchestrator's own `goto` / `history.back()` re-entry regardless
	 *  of timer or popstate ordering. */
	#dispatchTarget: string | null = null;
	/** The raw drag fraction in [0, 1]. The state machine owns the macro
	 *  authority (phase, plan, FROM/TO, direction); this field owns the
	 *  sub-frame progress the FAB layer reads. The orchestrator publishes
	 *  it via `#publish(raw)` in two contexts: during live drags
	 *  (per-pointermove, synchronously, via `#interpretIntent`) and
	 *  during commit/cancel slides (per-executor-rAF-tick via
	 *  `#onExecutorTick`). It is reset to 0 in `configure`,
	 *  `#beginGesture`, `playEnterAnimation`,
	 *  `onSvelteKitBeforeNavigate` (the discrete-nav branch),
	 *  `#landAtRest`, and `unmount`. The executor does not write it
	 *  directly. The `#publication` derived merges it with the macro
	 *  state. */
	#progress = $state(0);
	/** Reactive publication: a read-through to the state machine's macro
	 *  state (plan, FROM/TO, direction, in-flight phase) and settle +
	 *  tap-scrub micro state, merged with the orchestrator's `#progress`
	 *  (synchronous per pointermove during a drag, via the executor's rAF
	 *  during a commit/cancel slide). Per DV20 §13.5 the state machine is
	 *  the sole authority; this derived has no independent state. */
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
				settleStartProgress: this.#settleStartProgress,
				settleTargetProgress: this.#settleTargetProgress,
				settleMorphFraction: this.#settleMorphFraction(),
				settleLatched: this.#stateMachine.settleLatched,
				settleDirection: this.#stateMachine.settleDirection,
				settleAwaitTitle: this.#stateMachine.settleAwaitTitle,
				searchScrubbing: this.#stateMachine.searchScrubbing,
				lastDispatchWasDeepToDeep: this.#lastDispatchWasDeepToDeep
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
			settleStartProgress: this.#settleStartProgress,
			settleTargetProgress: this.#settleTargetProgress,
			settleMorphFraction: this.#settleMorphFraction(),
			settleLatched: this.#stateMachine.settleLatched,
			settleDirection: this.#stateMachine.settleDirection,
			settleAwaitTitle: this.#stateMachine.settleAwaitTitle,
			searchScrubbing: this.#stateMachine.searchScrubbing,
			lastDispatchWasDeepToDeep: this.#lastDispatchWasDeepToDeep
		};
	});

	/** The settle rAF's eased timeline fraction (0 at arm, 1 at duration
	 *  end). The morph derivation in the Header reads this (via the
	 *  publication's `settleMorphFraction` field) to interpolate from the
	 *  latched `startMorph` to `destMorph`, so the morph stays continuous
	 *  across the drag-to-settle handoff for every gesture shape and
	 *  every commit saturation. Returns 0 at rest (the at-rest branch in
	 *  the Header reads the static tab-ness instead). */
	#settleMorphFraction(): number {
		return this.#settleEasedFraction;
	}
	/** The raw drag-fraction published at the moment a commit / cancel
	 *  began. The commit-phase publication lerps from this value to the
	 *  target (1 commit / 0 cancel) along the executor's eased fraction,
	 *  so `backMorph` (deep-page / backward-to-deep-page Header morph)
	 *  and the FAB's `publication.progress` stay continuous across the
	 *  drag-to-commit boundary for every transition that starts a
	 *  commit/cancel (gesture from rest, mid-transition interrupt,
	 *  tab-click / enter with no live drag). A sub-threshold cancel
	 *  lands at rest immediately and bypasses this. */
	#commitStartRaw = 0;
	/** True iff the previous #interpretIntent call was for any claimed
	 *  drag (micro === 'drag-right' or 'drag-left' on bidirectional
	 *  hosts). Used to detect a gesture start (micro transitions into a
	 *  claimed drag direction), including a re-grab mid-commit. */
	#prevWasDrag = false;
	/** The gesture-resolved destination tab index, set by
	 *  `#beginGesture` / `onSvelteKitBeforeNavigate` and read by
	 *  `#republishToPager` so the pill interpolation follows the actual
	 *  destination, not the at-rest `mountInputs.toTabIndex`. Cleared on
	 *  land, releaseInputs, and unmount. */
	#gestureToTabIndex: number | null = null;

	// ---------------------------------------------------------------------
	// Settle ease state. The orchestrator owns the Header's post-release /
	// post-title-change crossfade. The rAF below eases the settle progress
	// toward `#settleTargetProgress` over the duration passed to
	// `#armSettleEase` (the velocity-matched commit duration for a
	// gesture-release settle, `TITLE_CROSSFADE_MS` for a non-gesture
	// settle) with the constant-deceleration curve `s(u) = 2u - u²` (the
	// same curve the executor's commit loop and the tap-scrub ease use).
	// Each tick writes the eased progress to the state machine (the §13.5
	// authority); the Header reads it via the orchestrator's publication.
	// Reduced-motion snaps (no rAF integration).
	#settleRafId: number | undefined;
	/** The settle progress's start value on the publication's raw scale
	 *  (the release position for a gesture-release settle, 0 for a
	 *  non-gesture title-change settle). The settle rAF advances
	 *  `stateMachine.settleProgress` from this value toward
	 *  `#settleTargetProgress`, publishing the raw-scale position the
	 *  title-view spans read (they share the raw scale with
	 *  `pager.backMorph`). `$state`-backed so the publication derived
	 *  re-runs on a fresh arm. */
	#settleStartProgress = $state(0);
	/** The settle progress's terminal value on the publication's raw
	 *  scale (1 for commit / click, 0 for cancel). `$state`-backed for
	 *  the same reason as `#settleStartProgress`. */
	#settleTargetProgress = $state<0 | 1>(1);
	/** The settle rAF's eased timeline fraction (0 at arm, 1 at duration
	 *  end). Drives `settleMorphFraction` independent of the raw progress
	 *  scale: when a drag saturates before release (raw=1 well before the
	 *  finger lifts) the commit arms with `settleStartProgress ===
	 *  settleTargetProgress === 1`, so normalizing from `settleProgress`
	 *  would divide zero by zero and saturate instantly, snapping the morph
	 *  from `startMorph` to `destMorph` in one frame. Tracking the eased
	 *  timeline directly keeps the morph interpolating across the settle's
	 *  full duration for every shape, saturated or not. */
	#settleEasedFraction = $state(0);
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
	// ease uses. The scrub runs on its OWN rAF, independent of the
	// executor's slide (it arms only when `pager.transitionTarget ===
	// null`, i.e. no pipeline transition is in flight). Reduced-motion
	// snaps.
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
	 *  dispatch time in `#dispatchNav` BEFORE the navigation lands; the
	 *  assigned value is `isNavPipelineRoute(target)` (true for a
	 *  pipeline target, false otherwise). The explicit `false` write
	 *  for a non-pipeline target is the mitigation against a stale
	 *  `true` leaking past a non-pipeline detour: the clear-sites below
	 *  all skip on a non-pipeline landing, so a non-pipeline dispatch
	 *  must clear the flag itself. Setting the value BEFORE land is
	 *  load-bearing: the Header's `notifyHeaderState` `$effect.pre`
	 *  fires BEFORE `afterNavigate`, so it reads the CURRENT
	 *  navigation's flag (a flag set at land time would be stale at
	 *  header-notification time).
	 *  Read in `notifyHeaderState` so the tap-scrub arming can skip the
	 *  just-landed pipeline commit (the executor's slide already drove
	 *  the search-layout visual to its post-land position; arming a
	 *  fresh scrub would re-animate it from the opposite endpoint and
	 *  jump). Cleared in five places: `#landAtRest` (the navigation
	 *  has landed), `notifyHeaderState`'s main body (defensive clear
	 *  after the read so a second header-state notification within the
	 *  same navigation does not re-consume the flag), the supersede
	 *  branch in `onSvelteKitBeforeNavigate` (an external nav cancels
	 *  our in-flight goto so `#landAtRest` never runs; without this
	 *  clear the stale true would skip a tap-scrub arm on the next
	 *  pipeline commit), `#beginGesture` (a new gesture invalidates
	 *  the in-flight dispatch's markers: clearing `#navDispatchInFlight`
	 *  here makes the pending afterNavigate short-circuit before
	 *  `#landAtRest`, so the landing-state flags must be cleared here
	 *  too or they leak into the gesture's `notifyHeaderState` /
	 *  `shouldEnter` reads), and `unmount` (the mobile -> desktop flip
	 *  tears down the host inputs; without this clear the stale true
	 *  would survive the desktop detour and skip a tap-scrub arm when
	 *  the user returns to mobile). */
	#lastLandWasPipelineCommit = false;
	/** Handshake flag: true when the most recent dispatch was a
	 *  deep-to-deep interception (the orchestrator cancelled a
	 *  detail -> detail nav and armed the slide on the SOURCE host).
	 *  Read by the DESTINATION host's `shouldEnter` `$derived`
	 *  (NavPipelineHost.svelte) to suppress `playEnterAnimation`: a
	 *  deep-to-deep target always has `stack[length-2].pathname ===
	 *  leftHref` (the source deep page is the destination's
	 *  back-target), so the generic forward-enter heuristic would
	 *  otherwise play a SECOND slide on the destination host (the
	 *  orchestrator already animated the slide on the source host).
	 *
	 *  Lifecycle of the flag (the handshake):
	 *   - SET to true in `onSvelteKitBeforeNavigate`'s deep-to-deep
	 *     branch, where the orchestrator cancels the nav and arms the
	 *     slide on the source host. Survives the source host's
	 *     `releaseInputs` (onDestroy) and the destination host's
	 *     `configure` (onMount) - intentionally NOT cleared in either,
	 *     unlike `#pendingDiscreteNav` / `#navDispatchInFlight` (cleared
	 *     by `releaseInputs`, so they do not survive the source host's
	 *     teardown) and `#lastLandWasPipelineCommit` (cleared by
	 *     `#landAtRest`, `notifyHeaderState`'s main body, the supersede
	 *     branch in `onSvelteKitBeforeNavigate`, `#beginGesture`, and
	 *     `unmount`; it is read by `notifyHeaderState`, not by
	 *     `shouldEnter`).
	 *   - READ by the destination host's `shouldEnter` at onMount (via
	 *     the publication's `lastDispatchWasDeepToDeep` field) to
	 *     suppress the enter animation.
	 *   - CLEARED to false in five places. (a) `#landAtRest`, which
	 *     runs in `onSvelteKitAfterNavigate` AFTER the destination
	 *     host's onMount (so the flag is still true when `shouldEnter`
	 *     reads it); a deep-to-deep target is always a pipeline route
	 *     (the `isDeepToDeep` guard requires `isNavPipelineRoute(to)`),
	 *     so `#landAtRest` is guaranteed to run for it on a normal
	 *     landing. (b) The supersede branch in
	 *     `onSvelteKitBeforeNavigate` (the `#navDispatchInFlight` true,
	 *     target-mismatch case): an external nav cancels the in-flight
	 *     goto so `#landAtRest` never runs; without this clear a stale
	 *     true would suppress a later forward-enter slide in
	 *     `shouldEnter`. (c) The non-tab-root non-deep-to-deep
	 *     early-return branch in `onSvelteKitBeforeNavigate`: a nav
	 *     arriving in the pre-dispatch window (after the deep-to-deep
	 *     intercept set the flag and armed the slide on the source
	 *     host, but before the commit rAF reached `#dispatchNav` and
	 *     set `#navDispatchInFlight`, so the supersede branch in (b)
	 *     does not fire) is not itself a deep-to-deep intercept, so
	 *     the handshake does not apply to it; without this clear the
	 *     stale true would suppress the destination's
	 *     `playEnterAnimation` and land the route with a hard cut.
	 *     Covers a pipeline destination (`/profile` -> `/search`) and
	 *     a non-pipeline destination (`/profile` -> `/drafts`).
	 *     (d) `#beginGesture`, which clears `#navDispatchInFlight`
	 *     alongside this flag (a new gesture invalidates the in-flight
	 *     dispatch's markers); the same ordering rationale as for
	 *     `#lastLandWasPipelineCommit` applies. (e) `unmount`, which
	 *     resets every transient transition field so the next mount
	 *     (a desktop -> mobile flip that re-enters mobile) starts
	 *     clean.
	 *
	 *  Backed by `$state` because the `#publication` `$derived.by`
	 *  reads it to publish `lastDispatchWasDeepToDeep` for the
	 *  destination host's `shouldEnter`; Svelte 5 `$derived` only
	 *  re-runs on `$state` / `$derived` reads, so the `$state` backing
	 *  is what makes the derived re-publish on a write. */
	#lastDispatchWasDeepToDeep = $state(false);

	/** The morph value the in-flight settle was rendering the instant a
	 *  drag took over (re-grab mid-commit, gesture-during-forward-enter),
	 *  paired with the publication's raw at that instant. null when no
	 *  settle was in flight at #beginGesture (drag from rest) or after the
	 *  drag ends (the next settle's `#armSettleEase` / `#landAtRest`
	 *  clears it). Read by the Header's morph drag branch to shift the
	 *  natural drag-morph curve so it passes through the takeover visual
	 *  (DV21 §5 "following-visual": a drag tracks from the current visual,
	 *  no jump). Symmetric to how the settle's `startMorph` captures the
	 *  drag's terminal value at release. Typed by `DragMorphAnchor` in
	 *  `header-probe.ts` (the shared shape so the Header and the probe
	 *  snapshot import one definition). */
	#dragMorphAnchor = $state<DragMorphAnchor | null>(null);
	/** The FAB scale value at the moment a drag took over an in-flight
	 *  settle, paired with the publication's raw at that instant (on the
	 *  NEW gesture's scale). Captured at `#beginGesture` alongside
	 *  `#dragMorphAnchor` so the FAB layer's scale derivation can shift the
	 *  natural `fabScale(progress, ...)` curve through the takeover visual
	 *  (DV21 §5: no jump at the settle-to-drag boundary). null when no
	 *  settle was in flight at `#beginGesture` or after the drag ends; the
	 *  same clear sites as `#dragMorphAnchor` keep the two anchors in
	 *  lockstep. */
	#dragFabAnchor = $state<DragFabAnchor | null>(null);
	/** The FAB lerp anchor the FAB layer's branch 3 interpolates from
	 *  `start` to `dest` across `settleMorphFraction` during a settle. Five
	 *  reach paths set this anchor; each captures `start` as the FAB value
	 *  the visual was rendering the instant before the settle took over, so
	 *  the FAB layer's branch 3 lerps from the captured visual to the
	 *  destination's resting scale (no snap at the boundary, DV21 §5):
	 *   1. `playEnterAnimation` at a forward-enter: `start` is the prior
	 *      commit's terminal FAB scale (stashed into
	 *      `#priorTerminalFabScale` because the publication's `progress`
	 *      resets 1 -> 0 between the commit and the enter); `dest` is the
	 *      host route's FAB presence (R8-A F4).
	 *   2. `#accelerateInFlight` at a discrete-nav interrupt of an
	 *      in-flight settle (R10-A F1): `start` is the FAB value
	 *      captured via `#fabScaleAtSettleInstant` BEFORE the arm
	 *      clear; `dest` carries over the prior anchor's `dest` (the
	 *      accelerate preserves endpoints). The capture is non-null
	 *      here because the commit slide is in flight at the
	 *      accelerate instant (`pub.inFlight === true`, so the
	 *      `!pub.inFlight` short-circuit in `#fabScaleAtSettleInstant`
	 *      does not fire). For an anchor-set settle being accelerated
	 *      (gesture-release, discrete-nav, mid-settle absorb, R12-B
	 *      F1 siblings that set `#enterFabAnchor`) the FAB layer
	 *      reads branch 3 (enterAnchor lerp), not branch 5 (natural
	 *      formula); the re-seed's skip guard is
	 *      `prevEnterFabAnchor !== null`, and the capture via
	 *      `#fabScaleAtSettleInstant` mirrors branch 3 (single source
	 *      of truth). The re-seed is skipped when the in-flight
	 *      settle was armed by a path that left `#enterFabAnchor`
	 *      null at the arm (from-rest discrete-nav or fresh-enter);
	 *      the FAB layer then reads branch 5 end-to-end.
	 *   3. `#armSettleEaseFromGesture` at a gesture release: `start` is the
	 *      FAB value captured via `#fabScaleAtSettleInstant` BEFORE the
	 *      arm clear; `dest` is the destination's (commit) or source's
	 *      (cancel) at-rest FAB presence (R12-B F1). For symmetric shapes
	 *      the captured value already equals the natural formula at the
	 *      release raw, so the lerp is a no-op for the visual but still
	 *      correct; for asymmetric shapes (from-only-FAB, to-only-FAB,
	 *      boundary, suppressed) the lerp is the only continuity guard
	 *      because the natural formula disagrees with the drag-terminal
	 *      FAB value at the release raw.
	 *   4. The `onSvelteKitBeforeNavigate` discrete-nav arm at a tab-click
	 *      / `goto` / popstate interrupt of an in-flight drag or settle:
	 *      `start` is the FAB value captured via
	 *      `#fabScaleAtSettleInstant` BEFORE the arm clear; `dest` is the
	 *      destination's at-rest FAB presence (the arm always targets
	 *      `settleTargetProgress = 1`, R12-B F1 sibling). For a from-rest
	 *      tab-click (no live drag) the publication is at rest at the
	 *      capture moment, so `#fabScaleAtSettleInstant` returns `null`
	 *      (its `!pub.inFlight` guard short-circuits); the re-seed's
	 *      `if (capturedFabScale !== null)` guard skips, leaving
	 *      `#enterFabAnchor` null so the FAB layer reads branch 5 (the
	 *      natural `fabScale(progress, ...)` formula) end-to-end across
	 *      the settle. For a re-grab (a drag that took over an in-flight
	 *      settle) the capture mirrors the dragAnchor-shifted value,
	 *      which the natural formula would otherwise snap from at the new
	 *      `startProgress`.
	 *   5. The `notifyHeaderState` mid-settle absorb when a dynamic-title
	 *      route resolves a new title mid-enter: `start` is the FAB value
	 *      captured via `#fabScaleAtSettleInstant` BEFORE the arm clear;
	 *      `dest` is the new endpoint's at-rest FAB presence selected by
	 *      `settleTargetProgress` (commit -> incoming, cancel -> outgoing,
	 *      R12-B F1 sibling). For an anchor-set non-enter settle being
	 *      re-armed (gesture-release, discrete-nav, accelerate-in-flight)
	 *      the FAB layer reads branch 3 and the re-seed is required for
	 *      boundary continuity; only the idle title-change arm (from-rest
	 *      same-tab-ness navs) leaves `#enterFabAnchor` null at the
	 *      capture so the null-guard skips the re-seed.
	 *
	 *  Cleared at the next settle arm (canonical single-site reset inside
	 *  `#armSettleEase`), `#landAtRest`, and `unmount`. */
	#enterFabAnchor = $state<EnterFabAnchor | null>(null);
	/** The search-axis lerp anchor for the Header's `searchProgress`
	 *  derivation. Two reach paths set this anchor (see `SearchAnchor` in
	 *  `header-probe.ts` for the full rationale): `playEnterAnimation` at a
	 *  forward-swipe-to-`/search` commit-to-enter handoff (hold at 1 so the
	 *  search panel stays slid in across the enter settle), and the
	 *  `onSvelteKitBeforeNavigate` discrete-nav arm at a non-search
	 *  interrupt of a forward-swipe-to-`/search` (retreat from the live
	 *  `bm` to 0 across the discrete-nav settle). The Header's
	 *  `searchProgress` derivation lerps from `start` to `dest` across
	 *  `settleMorphFraction` while `settleActive && searchAnchor !== null`.
	 *  Cleared at the next settle arm (canonical single-site reset inside
	 *  `#armSettleEase`), `#landAtRest`, and `unmount`. */
	#searchAnchor = $state<SearchAnchor | null>(null);
	/** The FAB scale captured at the moment a commit slide ends (raw =
	 *  1), stashed here so the next `playEnterAnimation` can seed
	 *  `#enterFabAnchor` for the commit-to-enter handoff (R8-A F4).
	 *  Consumed (set back to null) by `playEnterAnimation`; also cleared
	 *  in three sites so the stash cannot leak to a later enter:
	 *  `#onExecutorSettle`'s non-pipeline-target branch (the destination
	 *  never runs `playEnterAnimation`), `#landAtRest`, and `unmount`.
	 *  `configure` and `releaseInputs` do NOT clear it (the host swap
	 *  between a pipeline commit and the destination's enter must
	 *  preserve the stash across the swap), so the non-pipeline-target
	 *  clear is the only guard against a stale stash surviving a detour
	 *  through a non-pipeline route. */
	#priorTerminalFabScale = $state<number | null>(null);
	/** The search-axis position captured at the moment a commit slide ends
	 *  (raw = 1), stashed here so the next `playEnterAnimation` can seed
	 *  `#searchAnchor` for the commit-to-enter handoff (R23-B F2). Consumed
	 *  (set back to null) by `playEnterAnimation`; cleared at the same sites
	 *  as `#priorTerminalFabScale` (`#onExecutorSettle`'s non-pipeline-target
	 *  branch, `#landAtRest`, and `unmount`) so the stash cannot leak. */
	#priorTerminalSearchProgress = $state<number | null>(null);

	constructor(clock: ClockFn = defaultClock) {
		this.#clock = clock;
	}

	/** Reactive publication for downstream consumers. The FAB layer reads
	 *  this directly (`progress`, FROM/TO FAB presence, and the boundary
	 *  / suppressed / anchor overrides drive its `computeFabScale`
	 *  derivation); the host components read `publication` via `$derived`
	 *  to drive their reactive templates. The orchestrator is the sole
	 *  writer of the in-flight pager state: `#publish` ->
	 *  `#republishToPager` writes the pager fields on every drag-move /
	 *  commit-tick so the Header layer (reader of `backMorph`) reacts to
	 *  the orchestrator's state. Hosts call only `resetPagerStore()` for
	 *  the at-rest reset on teardown. The Header's settle ease (post-release
	 *  / post-title-change morph + crossfade) is read directly off the
	 *  orchestrator singleton, NOT via these pager fields. */
	get publication(): OrchestratorPublication {
		return this.#publication;
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
	/** Reactive read of the eased settle progress's start value (the release
	 *  raw for a gesture-release settle, 0 for a non-gesture arm). Read by
	 *  the Header (via the publication) to compute the morph interpolation
	 *  window. */
	get settleStartProgress(): number {
		return this.#publication.settleStartProgress;
	}
	/** Reactive read of the eased settle progress's terminal value (1 for a
	 *  commit / click, 0 for a cancel). Read by the Header to compute the
	 *  morph interpolation window. */
	get settleTargetProgress(): 0 | 1 {
		return this.#publication.settleTargetProgress;
	}
	/** Reactive read of the normalized 0..1 fraction of the eased settle
	 *  curve traversed so far. Read by the Header's morph derivation to
	 *  interpolate `settleLatched.startMorph` to `settleLatched.destMorph`
	 *  across the settle. */
	get settleMorphFraction(): number {
		return this.#publication.settleMorphFraction;
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
	/** Reactive read of the drag's morph anchor (the visual morph at the
	 *  instant a drag took over an in-flight settle). Read by the Header's
	 *  morph drag branch to shift the natural drag-morph curve so it
	 *  passes through the takeover visual (no snap at the
	 *  settle-to-drag boundary). null when no settle was in flight at
	 *  #beginGesture or after the drag ends. */
	get dragMorphAnchor(): DragMorphAnchor | null {
		return this.#dragMorphAnchor;
	}
	/** Reactive read of the drag's FAB anchor (the visual scale at the
	 *  instant a drag took over an in-flight settle). Read by the FAB
	 *  layer's scale derivation to shift the natural fabScale curve so it
	 *  passes through the takeover visual (no snap at the
	 *  settle-to-drag boundary). null when no settle was in flight at
	 *  #beginGesture or after the drag ends. */
	get dragFabAnchor(): DragFabAnchor | null {
		return this.#dragFabAnchor;
	}
	/** Reactive read of the enter FAB anchor. Read by the FAB layer's
	 *  scale derivation during any settle that set the anchor (five
	 *  reach paths; see the `#enterFabAnchor` field docstring). null
	 *  when no settle has set the anchor (the canonical clear runs at
	 *  the top of `#armSettleEase`, plus `#landAtRest` and `unmount`). */
	get enterFabAnchor(): EnterFabAnchor | null {
		return this.#enterFabAnchor;
	}
	/** Reactive read of the search anchor. Read by the Header's
	 *  `searchProgress` derivation during any settle that set the anchor
	 *  (two reach paths; see the `#searchAnchor` field docstring). null
	 *  when no settle has set the anchor (the canonical clear runs at the
	 *  top of `#armSettleEase`, plus `#landAtRest` and `unmount`). */
	get searchAnchor(): SearchAnchor | null {
		return this.#searchAnchor;
	}

	/** Configure: capture the host's mount inputs, rebind the element
	 *  resolver, forceReset the shared state machine to at-rest on this
	 *  route's tag, reset the publication, and run the lifecycle
	 *  `activate`. Construct-once: the executor + driver are built on the
	 *  first configure and reused across every subsequent configure; only
	 *  the per-host inputs + element-resolver are rebound. The route-swap
	 *  pairing is `releaseInputs` (old host) -> `configure` (new host) on
	 *  the same singleton; no rAF is cancelled and no lifecycle `unmount`
	 *  runs between them, so the persistent FAB / Header layers see a
	 *  continuous signal. */
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
		// Reset the executor's animation state so a stale prior commit
		// cannot leak into this host. If a prior commit settled
		// (activePlan set, progress = 1) but the navigation was
		// cancelled before landing (`#landAtRest` / `executor.onLand()`
		// never ran), the executor still holds progress = 1 with an
		// active plan. The next host's `playEnterAnimation` would then
		// read that stale state via `#startProgressFromCurrentVisual`,
		// return 1, and the enter slide would no-op (`startCommit`'s
		// `state.progress === target` guard). `onLand()` only stops the
		// rAF, clears `activePlan`, and resets the state record to
		// `initialExecutorState()` - no side effects outside the
		// executor - so it is safe to call here on every configure.
		// The settle / tap-scrub eases live on the orchestrator (not the
		// executor) and are unaffected.
		this.#executor.onLand();
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
		this.#mounted = true;
		this.#lifecycle.activate();
	}

	/** Release the host's inputs and run the lifecycle `deactivate`. The
	 *  singleton's executor + driver + rAF + lifecycle `mount` persist
	 *  for the next host's `configure`; this is the route-swap teardown
	 *  path. The gap-frame publication's MACRO fields read at-rest (the
	 *  `!#mounted` guard in `#publication` returns at-rest for plan /
	 *  progress / inFlight / FROM-TO / direction); the settle + tap-scrub
	 *  micro-state stays live across the swap so the persistent Header
	 *  keeps driving an in-flight settle / scrub. */
	releaseInputs(): void {
		this.#mountInputs = null;
		this.#mounted = false;
		this.#pendingGesture = null;
		this.#pendingDiscreteNav = null;
		this.#navDispatchInFlight = false;
		this.#dispatchTarget = null;
		this.#gestureToTabIndex = null;
		// Clear the in-flight enter flag: a non-intercepted nav that
		// abandons an in-flight enter must not leave a stale enter flag
		// suppressing the destination host's guards (afterNavigate /
		// resize).
		this.#isEnterAnimation = false;
		this.#commitStartRaw = 0;
		// Clear the live-drag flags. A host destroyed mid-drag (an
		// external nav to a non-pipeline route while the finger is still
		// down) never receives the pointerup, so the release path that
		// normally clears these does not run. Without this clear the next
		// pipeline host's forward enter would read a stale `#liveDragging`
		// and publish `pager.dragging = true` (corrupting the Header morph
		// / titleView), and a stale `#prevWasDrag` would delay the next
		// gesture's start by one event.
		this.#liveDragging = false;
		this.#prevWasDrag = false;
		// Do NOT cancel the settle / tap-scrub eases here: the Header
		// persists across the route swap, and a settle in flight at the
		// host's destroy (a commit settle awaiting its navigation landing)
		// must continue until the navigation lands. `notifyHeaderState`'s
		// `!this.#mounted` guard skips re-arming during the gap frame
		// (releaseInputs -> the next configure) AND on a mobile -> desktop
		// flip (unmount); the afterNavigate hook clears the awaitTitle
		// once the navigation lands. `#queuedDiscreteNav` is likewise
		// retained here: the finish-then-new replay fires from `#landAtRest`
		// on the destination host's afterNavigate, so the queue must
		// survive the source host's destroy.
		// Clear the in-flight pager state so a stale fractionalIndex /
		// transitionTarget does not drive the Header on the destination
		// route before that route's configure publishes its own state.
		getMobilePagerStore().set({
			fractionalIndex: 0,
			dragging: false,
			active: false,
			backMorph: null,
			targetIndex: null,
			transitionTarget: null
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
		if (
			this.#pendingGesture !== null ||
			this.#pendingDiscreteNav !== null ||
			this.#isEnterAnimation
		)
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
	 *  slides to `translateX(-W)` (centre visible) over ~300ms (COMMIT_T_DEFAULT_MS) via
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
		if (this.#pendingGesture !== null || this.#pendingDiscreteNav !== null) return;
		const plan: TransitionPlan = {
			pageTrack: {
				axis: 'left',
				distance: w,
				restingTranslate: 0
			},
			// During the enter, the FAB layer reads branch 3 (enterAnchor
			// lerp via `computeFabScale`) once `#enterFabAnchor` is seeded
			// below; for a fresh-enter (`#priorTerminalFabScale === null`)
			// the anchor is never set and the FAB layer reads branch 5 (the
			// natural `fabScale(progress, ...)` formula) end-to-end. The
			// Header morph during the enter is NOT driven by `backMorph`
			// (which is read only during a
			// live drag); it is driven by the settle ease armed at the bottom
			// of this method. The latched `startMorph` is the source route's
			// at-rest morph and `destMorph` is the host route's at-rest
			// morph; the Header's morph derivation lerps between them across
			// `settleMorphFraction` as the slide runs, carrying the morph
			// from the source route's tab-ness to the host route's
			// tab-ness.
			progressDirection: 0,
			commitPhysics: this.#driver?.prefersReducedMotion() ? 'snap' : 'momentum'
		};
		this.#pendingGesture = null;
		this.#pendingDiscreteNav = null;
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
		// Seed `#commitStartRaw` from the visual-derived `startProgress`
		// (consistent with #beginGesture / onSvelteKitBeforeNavigate).
		// For the enter case there is no in-flight plan (configure reset
		// the executor), so `startProgress` is 0; the publication's
		// commit-phase lerp thus starts at the at-rest endpoint.
		this.#commitStartRaw = startProgress;
		executor.onDragStart(plan, startProgress);
		// No finger-release velocity on a forward-enter: pass 0 and let the
		// velocity-matched solver pick the default duration
		// (`COMMIT_T_DEFAULT_MS`). The Header settle reads the resulting
		// `commitStart.durationMs` and matches it (R17), so no desync.
		executor.onCommit(0);
		this.#stateMachine.onCommit();
		// Arm the settle ease so the Header morph + title crossfade track
		// the slide. The defensive arm is required because the Header's
		// `notifyHeaderState` `$effect.pre` may have fired during the gap
		// frame (releaseInputs -> configure) when `#mounted` was false and
		// early-returned, leaving the title change unprocessed. Arming here
		// makes the enter's morph / crossfade independent of
		// notifyHeaderState arriving after configure. The latched endpoints
		// are derived from `inputs.backTarget` (the source route) and
		// `inputs.fromPathname` (the host route) so the morph runs from the
		// source's tab-ness to the host route's tab-ness (e.g. tab mode at
		// the source tab root easing into deep mode on a thread, compose,
		// or deep page). The outgoing title uses `resolveDeepHeaderTitle(inputs.backTarget)`
		// (the source/back-target route's STATIC title), NOT `#prevHeaderTitle`:
		// the Header's `$effect.pre` fires BEFORE `onMount` (where
		// `playEnterAnimation` runs), so `#prevHeaderTitle` has already been
		// updated to the destination's title by the time this code runs. The
		// back-target is the route behind the host: a tab root for tab-to-deep
		// enters (resolver returns null -> ''), or a deep page for detail-to-
		// search enters (not deep-to-deep, not intercepted; resolver returns the
		// deep page's static title). For a dynamic-title back-target the
		// resolver returns null -> '' (the live title was replaced by the
		// `$effect.pre` update). The incoming uses the resolver (the host
		// route's static title) for endpoint symmetry with the outgoing so
		// the crossfade latched pair is stable across destination load-timing.
		// The live destination title is already in `#prevHeaderTitle` when
		// this runs (the Header's `$effect.pre` fires BEFORE this host's
		// `onMount`, so the live `page.data.headerTitle` is available before
		// the settle starts, not after). It is displayed when the settle
		// completes and the title view's at-rest branch (which reads the live
		// `page.data.headerTitle`) takes over as `settleActive` becomes false.
		const t = this.#headerT;
		if (t !== null) {
			const outgoingTitle = resolveDeepHeaderTitle(inputs.backTarget, t) ?? '';
			const incomingTitle = resolveDeepHeaderTitle(inputs.fromPathname, t) ?? '';
			const outgoingHasTabs = getCurrentTabIndex(inputs.backTarget) >= 0;
			const incomingHasTabs = getCurrentTabIndex(inputs.fromPathname) >= 0;
			// No preceding drag for a forward-enter: the morph at the arm is
			// the source route's at-rest morph; the settle interpolates from
			// there to the host route's at-rest morph as the slide runs.
			const startMorph = this.#atRestMorph(outgoingHasTabs);
			const destMorph = this.#atRestMorph(incomingHasTabs);
			const latched: HeaderSettleTransition = {
				outgoingTitle,
				incomingTitle,
				outgoingHasTabs,
				incomingHasTabs,
				startMorph,
				destMorph
			};
			const commitDurationMs = executor.state.commitStart?.durationMs ?? TITLE_CROSSFADE_MS;
			this.#armSettleEase(latched, 0, 1, false, 'forward', commitDurationMs);
		}
		// Seed the enter FAB anchor (R8-A F4) AFTER `#armSettleEase` so the
		// clear at the top of `#armSettleEase` does not wipe it. The prior
		// commit's terminal FAB scale was stashed in
		// `#priorTerminalFabScale` by `#onExecutorSettle` (the publication's
		// `progress` resets 1 -> 0 between that point and this, so without
		// the stash the value would be lost). The destination's resting
		// scale is the host route's FAB presence. The FAB layer lerps
		// between them across `settleMorphFraction`; for the common
		// commit-to-enter shapes (start === dest, e.g. both 0 for
		// `/messages/inbox` -> `/search`) the lerp is a constant hold. For
		// a direct nav (no prior swipe-commit, `#priorTerminalFabScale` is
		// null) the natural `fabScale(progress, ...)` formula handles the
		// enter correctly and no anchor is set.
		if (this.#priorTerminalFabScale !== null) {
			const destScale = getRouteData(inputs.fromPathname).fab ? 1 : 0;
			this.#enterFabAnchor = { start: this.#priorTerminalFabScale, dest: destScale };
			this.#priorTerminalFabScale = null;
		}
		// Seed the search anchor (R23-B F2) AFTER `#armSettleEase` and AFTER
		// the FAB anchor seed above. Same stash pattern: the prior commit's
		// terminal searchProgress was stashed in
		// `#priorTerminalSearchProgress` by `#onExecutorSettle`. The
		// destination's at-rest searchProgress is `isSearch(host route) ? 1
		// : 0`. For the audit's flagship shape (a forward-swipe-to-
		// `/search` commit) the stash is `1` (the drag slid the panel fully
		// in) and the host route is `/search` so `dest = 1`: the lerp holds
		// the panel fully in across the enter settle, suppressing the
		// natural `searchProgress = 1 - trackMorph = bm` curve (which would
		// reset to 0 at the boundary then re-animate 0 -> 1 across the
		// enter slide). For a non-search direct nav
		// (`#priorTerminalSearchProgress` is null because no `isSearch` or
		// `targetIsSearch` flip occurred during the prior commit) no anchor
		// is set and the natural `searchProgress` handles the enter.
		if (this.#priorTerminalSearchProgress !== null) {
			const destSearch = resolveHeaderMode(inputs.fromPathname) === 'search' ? 1 : 0;
			this.#searchAnchor = { start: this.#priorTerminalSearchProgress, dest: destSearch };
			this.#priorTerminalSearchProgress = null;
		}
	}

	/** The at-rest morph for a route with the given tab-ness: 1 = tab/root
	 *  mode (hamburger, tab bar visible), 0 = deep mode (back-arrow, tab bar
	 *  hidden). Used by the non-gesture settle arm sites (forward-enter,
	 *  discrete-nav, idle title-change) to capture the morph at the arm
	 *  instant, which equals the source route's at-rest morph in those cases
	 *  (no preceding live drag owned the morph). */
	#atRestMorph(hasTabs: boolean): number {
		return hasTabs ? 1 : 0;
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
		const target = this.#pendingDiscreteNav?.target ?? this.#pendingGesture?.to;
		if (target !== undefined && !this.#navDispatchInFlight) {
			this.#dispatchNav(target);
		}
	}

	/** Unmount: full teardown. Stops the rAF, drops the plan + executor +
	 *  driver, and runs the lifecycle `unmount`. Used for the mobile ->
	 *  desktop flip only (the host stays mounted but the gesture surface
	 *  leaves the mobile breakpoint; both hosts' breakpoint handlers
	 *  call this). Route swaps do NOT call this; they call
	 *  `releaseInputs` so the singleton's executor + driver persist for
	 *  the next host's `configure`. App exit abandons the singleton to
	 *  the browser (no teardown runs). Idempotent. */
	unmount(): void {
		this.#executor?.stop();
		this.#executor = null;
		this.#driver = null;
		this.#pendingGesture = null;
		this.#pendingDiscreteNav = null;
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
		// Tear down the settle + tap-scrub eases so the next mount (a
		// desktop -> mobile flip that re-enters mobile) starts clean.
		// The header-state fields (`#headerStateInitialized`,
		// `#prevHeaderTitle`, `#prevHeaderHasTabs`, `#prevHeaderIsSearch`,
		// `#headerT`) are intentionally NOT cleared here: the Header
		// persists across the flip (AppShell stays mounted; only the
		// host swaps), so its last-reported state remains valid, and
		// the Header's `$effect.pre` keeps firing `notifyHeaderState`
		// during desktop-mode navigation - that call's `!#mounted`
		// branch writes `#headerT` unconditionally and refreshes the
		// three prev fields when no settle is active. Clearing them
		// here would leave a window (flip-without-navigation ->
		// back-swipe before any nav) where `#armSettleEaseFromGesture`
		// and `playEnterAnimation`'s `if (t !== null)` guard read
		// empty / null latched endpoints and run a 200ms title
		// crossfade against empty titles. `configure()` does not
		// touch these fields either; a real Header re-mount (an
		// AppShell unmount / remount across a `/entry/*` detour)
		// resets them via `resetHeaderState`, which the Header
		// component calls from its `onMount`.
		this.#cancelSettleEaseRaf();
		this.#cancelTapScrubRaf();
		this.#settleAwaitTitle = false;
		this.#settleStartProgress = 0;
		this.#settleEasedFraction = 0;
		this.#settleStartTs = 0;
		this.#scrubSource = '';
		this.#scrubTargetTabs = false;
		this.#scrubFromValue = 0;
		this.#scrubToValue = 0;
		this.#scrubStartTs = 0;
		this.#scrubTerminal = 0;
		this.#lastLandWasPipelineCommit = false;
		this.#lastDispatchWasDeepToDeep = false;
		this.#dragMorphAnchor = null;
		this.#dragFabAnchor = null;
		this.#enterFabAnchor = null;
		this.#priorTerminalFabScale = null;
		this.#mountInputs = null;
		this.#mounted = false;
		this.#lifecycle.deactivate();
		this.#lifecycle.unmount();
		// Clear the in-flight pager state so a stale fractionalIndex /
		// transitionTarget does not drive the Header on the destination
		// route before that route publishes its own state (mirrors the
		// at-rest pager publication each host sets on configure).
		getMobilePagerStore().set({
			fractionalIndex: 0,
			dragging: false,
			active: false,
			backMorph: null,
			targetIndex: null,
			transitionTarget: null
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
		getMobilePagerStore().setScrubIconEndpoint(null);
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
			// non-bidirectional hosts (thread, compose, deep page) the same window
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
			executor.onDragMove(trackProgress);
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
						this.#stateMachine.onCancel();
						// Arm the settle ease (cancel direction): the morph
						// + title crossfade retreat to the current page over
						// the cancel slide's solver-computed duration
						// (velocity-matched for a reversed release;
						// COMMIT_T_DEFAULT_MS for a drag-direction release).
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
						this.#stateMachine.onCommit();
						// Arm the settle ease (commit direction): the morph
						// + title crossfade advance toward the back-target
						// over the velocity-matched commit duration,
						// holding at progress 1 until the navigation lands.
						this.#armSettleEaseFromGesture(true);
					} else if (executor.state.progress > 0) {
						this.#commitStartRaw = this.#publication.progress;
						executor.onCancel(intent.releaseVelocity);
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

	/** Lock FROM/TO and run the resolver once. Handles both
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
		//
		// Before the cancel, capture the settle's current morph (the visual
		// the Header is rendering at the takeover instant) so the drag's
		// morph derivation can seed from it (DV21 §5 "following-visual": a
		// re-grab tracks from the current visual, no jump). `#endSettleEase`
		// (called by `#cancelAllAnimationEases`) clears `settleLatched`, so
		// the morph capture must happen first. The `raw` half of the anchor
		// is filled in AFTER `#pendingGesture.rawStart` is known (the new
		// gesture's raw scale, which is the scale `bm = pager.backMorph`
		// will be on once `#publish` runs). A direction-reversing re-grab
		// (a back-swipe taking over a forward-enter) has
		// `rawStart = 1 - enterProgress`, NOT `enterProgress`: the prior
		// settle's `publication.progress` is on the settle's plan scale,
		// not the new gesture's plan scale, and using it as `anchor.raw`
		// would put the shift formula's anchor point on the wrong scale,
		// snapping the morph at the takeover
		// (`anchor.morph + natural(bm) - natural(anchor.raw)` evaluates to
		// a value other than `anchor.morph` at `bm = rawStart`). The
		// two-phase capture (morph here, raw at the `#pendingGesture`
		// assignments below) puts both halves on the new gesture's scale.
		// Covers every drag-takes-over-settle boundary (re-grab mid-commit,
		// gesture-during-forward-enter, pointercancel during a settle).
		const settleMorphAtTakeover: number | null =
			browser && this.#stateMachine.settleActive && this.#stateMachine.settleLatched !== null
				? this.#morphAtSettleInstant(this.#stateMachine.settleLatched)
				: null;
		// FAB anchor (R8-A F3): capture the FAB scale the settle was
		// rendering at the takeover instant, paired with the new plan's
		// raw scale at #beginGesture. The FAB layer's scale derivation
		// reads `dragFabAnchor` and shifts the natural `fabScale(progress,
		// fromHasFab, toHasFab)` curve so it passes through
		// `(startProgress, settleFabAtTakeover)` (mirrors the morph's
		// `dragMorphAnchor` shift). `#fabScaleAtSettleInstant` computes
		// via the shared `computeFabScale` function the FAB layer also
		// calls, so the capture mirrors EVERY branch the FAB layer renders
		// (boundary void-swipe, suppressed tab slide, enter-anchor lerp,
		// drag-anchor shift, default natural) and stays continuous across
		// every re-grab shape (DV21 §5).
		const settleFabAtTakeover: number | null =
			browser && this.#stateMachine.settleActive && this.#publication.inFlight
				? this.#fabScaleAtSettleInstant()
				: null;
		this.#dragMorphAnchor = null;
		this.#dragFabAnchor = null;
		this.#cancelAllAnimationEases();
		if (this.#publication.inFlight) {
			this.#stateMachine.onInterrupt(intent);
		}
		// A gesture now owns the publication. Clear the enter flag; a
		// re-grab continues `backMorph` / `publication.progress` from the
		// publication's live raw.
		this.#isEnterAnimation = false;
		// Invalidate an in-flight dispatch's markers (analogous to the
		// enter-flag clear above). If a tab-click / discrete-nav commit
		// fired `#dispatchNav` and its `goto` is mid-flight (the 1-3-frame
		// window between `goto` and the destination's `afterNavigate`),
		// `#navDispatchInFlight` is still true and `#dispatchTarget` still
		// holds the dispatch's URL. Without this clear the pending
		// `afterNavigate` would see `#navDispatchInFlight === true` and
		// fall through to `#landAtRest`, which clears `#pendingGesture` and
		// wipes the gesture just begun (the drag goes unresponsive until
		// pointerup + re-press). Clearing here makes `afterNavigate`'s
		// `#pendingGesture !== null` guard short-circuit before
		// `#landAtRest`. The dispatch's `.finally` clears the same fields
		// again after `goto` resolves (no-op here, but defense-in-depth).
		// Also clear the two landing-state fields `#landAtRest` would have
		// cleared for this dispatch's landing (`#lastLandWasPipelineCommit`,
		// `#lastDispatchWasDeepToDeep`): with `#navDispatchInFlight`
		// cleared, `afterNavigate`'s guard returns early and `#landAtRest`
		// never runs, so the flags would otherwise survive the landing and
		// leak into the next nav's `notifyHeaderState` / `shouldEnter`
		// reads. The other landing-state (`#settleAwaitTitle`,
		// `replaceStateIntent`) is cleared by `onSvelteKitAfterNavigate`'s
		// unconditional preamble, so no clear is needed here for those.
		// The fields that `#landAtRest` clears but the gesture now owns
		// (`#pendingGesture`, `#liveDragging`, `#gestureToTabIndex`,
		// `#progress`) are intentionally NOT cleared here.
		this.#navDispatchInFlight = false;
		this.#dispatchTarget = null;
		this.#lastLandWasPipelineCommit = false;
		this.#lastDispatchWasDeepToDeep = false;
		this.#liveDragging = true;
		const from = inputs.fromPathname;
		const fromTag = inputs.fromTag;
		// Resolve the target for this direction. A backward gesture always
		// targets the previous history entry (the temporal-previous): on a
		// bidirectional host that is `previousEntryPathname()` (the entry
		// behind the current tab, whether it is the spatially-previous tab,
		// a deep page the user came from, or a higher-indexed tab when that
		// tab is the temporal-previous (the backward-to-higher-tab case:
		// the resolver returns axis 'right' so the track follows the
		// finger rightward, and the deepSnapshotTarget overlay reveals
		// the destination tab's content from the left)); on a
		// non-bidirectional host it is the mount-supplied back-target.
		// Forward targets the next
		// tab. Macro §6: a backward gesture always goes where the user
		// came from; the hop-vs-push decision is the generic `hopForHref`
		// check at dispatch time.
		const target: string | null =
			direction === 'backward'
				? inputs.bidirectional === true
					? this.#backwardTabTarget(inputs)
					: inputs.backTarget
				: this.#nextTabTarget(inputs);
		// A gesture claims the transition: drop any in-flight tab-click
		// (`#pendingDiscreteNav`) AND any tab-click queued by the
		// finish-then-new policy (`#queuedDiscreteNav`) so the gesture's
		// own commit dispatches THIS gesture's target. Without clearing the
		// queue, a re-grab mid-accelerated-commit (which stops the commit
		// rAF so `#onExecutorSettle` / `#landAtRest` never consume it)
		// would leave the queued tab-click to fire on the gesture's landing,
		// overriding the user's latest direct action.
		this.#pendingDiscreteNav = null;
		this.#queuedDiscreteNav = null;
		if (target === null) {
			// Boundary void-swipe on a bidirectional host (first tab with no
			// previous history entry): start a rubber-band gesture that tracks
			// the finger at a reduced factor and always snaps back on release.
			// No navigation is dispatched. (`target === null` is reachable
			// only via `#backwardTabTarget` returning null on the first tab
			// with no previous entry; the backward ternary returns
			// `inputs.backTarget` (non-null) for non-bidirectional hosts, and
			// `#nextTabTarget` resolves every forward target including the
			// last-tab to `/search`.)
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
			// `rawStart` is the new plan's progress at the current visual
			// position. It equals the value `#startProgressFromCurrentVisual`
			// returns for `boundaryPlan`, NOT `this.#progress`. The two can
			// diverge when this gesture interrupts an in-flight transition
			// whose FROM/TO differ from the new gesture's: the same visual
			// position maps to distinct raw values once FROM/TO swap, so
			// seeding the publication from the in-flight raw would publish
			// a scale already past the midpoint (the FAB jumps to ~0.6 from
			// frame 1 and saturates before the finger crosses half the
			// viewport, skipping the (0.3, 0.7) mid-range). Using the
			// visual-derived `startProgress` keeps the drag-driven
			// publication continuous with the track translate (which
			// `executor.onDragStart` seeds from the same value) once the
			// raw enters [0,1]: from-rest (both 0), same-direction
			// mid-commit (the new plan's geometry matches, so
			// `startProgress` equals the in-flight raw). On an
			// opposite-direction re-grab whose extrapolated
			// `startProgress` falls outside [0,1] (e.g. -0.6), `#publish`
			// clamps the raw it writes here, so `publication.progress`
			// stays at 0 while the track translate carries the unclamped
			// `-0.6 * W` (spec §5 divergence note: the track translate is
			// linear and well-defined for any progress, so it carries the
			// out-of-range value transiently while the publication stays
			// bounded). The publication and the track therefore diverge
			// until the raw catches up to the in-range region.
			const startProgress = this.#startProgressFromCurrentVisual(boundaryPlan);
			this.#pendingGesture = {
				to: from,
				startProgress,
				rawStart: startProgress,
				direction,
				boundary: true
			};
			// Complete the two-phase anchor capture: now that `rawStart` is
			// known (the new plan's raw scale), pair it with the morph the
			// settle was rendering at the takeover. The shift formula in the
			// Header reads `bm = pager.backMorph`, which `#publish` writes on
			// this same scale, so `anchor.raw` and `bm` agree and the shifted
			// curve passes through `(rawStart, anchor.morph)`.
			if (settleMorphAtTakeover !== null) {
				this.#dragMorphAnchor = { morph: settleMorphAtTakeover, raw: startProgress };
			}
			if (settleFabAtTakeover !== null) {
				this.#dragFabAnchor = { scale: settleFabAtTakeover, raw: startProgress };
			}
			this.#executor?.onDragStart(boundaryPlan, startProgress);
			return;
		}
		const to: string = target;
		const toData = getRouteData(to);
		const toTag = toData.tag;
		const toTabIndex =
			direction === 'backward'
				? inputs.bidirectional === true
					? this.#tabIndexFor(to)
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
		// See the boundary branch above: `rawStart` mirrors `startProgress`
		// so the publication's raw stays in lockstep with the track
		// translate across the FROM/TO swap on an opposite-direction
		// re-grab.
		this.#pendingGesture = {
			to,
			startProgress,
			rawStart: startProgress,
			direction,
			boundary: false
		};
		// Complete the two-phase anchor capture: pair the settle's morph at
		// the takeover instant with the new plan's raw scale (`rawStart`).
		// See the capture site above for why both halves must be on the new
		// gesture's scale.
		if (settleMorphAtTakeover !== null) {
			this.#dragMorphAnchor = { morph: settleMorphAtTakeover, raw: startProgress };
		}
		if (settleFabAtTakeover !== null) {
			this.#dragFabAnchor = { scale: settleFabAtTakeover, raw: startProgress };
		}
		this.#executor?.onDragStart(plan, startProgress);
	}

	/** Resolve the forward-gesture target for a leftward drag. The active
	 *  tab's spatial neighbour is the target. For the last tab there is no
	 *  spatial neighbour, so per DV20-Plan §6 the target falls through to
	 *  `/search`: the `{tab, search}` pair (`tabSearchResolver`) drives
	 *  the root<->search slide and the orchestrator publishes
	 *  `transitionTarget='/search'` plus the live `backMorph` so the
	 *  Header's searchProgress / trackMorph scrub the root<->search track
	 *  during the drag and on the commit slide. The return is non-null for
	 *  every tab host mount (`fromTabIndex >= 0`); the `string | null`
	 *  signature mirrors the backward ternary's union type at the call
	 *  site. */
	#nextTabTarget(inputs: PipelineMountInputs): string | null {
		const nextIdx = inputs.fromTabIndex + 1;
		if (nextIdx >= MOBILE_TABS.length) return '/search';
		return MOBILE_TABS[nextIdx].href;
	}

	/** Resolve the backward-gesture target for a bidirectional host. Per
	 *  macro §6 a backward gesture targets the previous history entry
	 *  (the temporal-previous): the entry behind the current tab, whether
	 *  that is the spatially-previous tab root (the common tab-to-tab
	 *  case, where spatial = temporal), a higher-indexed tab whose entry
	 *  is the temporal-previous (a tab-to-tab case where
	 *  spatial != temporal: the resolver returns axis 'right' so the
	 *  track follows the finger rightward, and the deepSnapshotTarget
	 *  overlay reveals the destination tab's content from the left),
	 *  or a deep page the user forward-
	 *  navigated from (the uncommon case, where spatial != temporal). On
	 *  commit, `#dispatchNav`'s `hopForHref` check decides history.back()
	 *  vs goto; for a deep page that sits behind the current tab it
	 *  returns `'back'`, so the user returns to where they came from.
	 *
	 *  When there is no previous entry (a hard-load of this tab with no
	 *  prior navigation history), the gesture falls back to the
	 *  spatially-previous tab root so the user is not stranded: every tab
	 *  has a bidirectional connection to its spatial neighbour (macro §6:
	 *  "all route types should have bidirectional connections"). The
	 *  target is thus history-driven whenever a previous entry exists
	 *  with no deep-page-vs-tab discrimination; the spatial layout is
	 *  consulted only for the no-history edge case. */
	#backwardTabTarget(inputs: PipelineMountInputs): string | null {
		const prev = previousEntryPathname();
		if (prev !== null) return prev;
		const prevIdx = inputs.fromTabIndex - 1;
		if (prevIdx < 0) return null;
		return MOBILE_TABS[prevIdx].href;
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
		// Non-bidirectional hosts (the 3-panel route host): the track is
		// 3*W wide (LEFT=back-target, CENTER=current, RIGHT=forward
		// deep-to-deep destination). restingTranslate = -W (CENTER's
		// position), distance = W; progress 0 -> 1 maps the track
		// from -W (CENTER fills the viewport) to -2W (RIGHT fills) for
		// a forward axis='left' plan, or from -W to 0 (LEFT fills) for
		// a backward axis='right' plan.
		//
		// Bidirectional hosts (the 3-panel tab host): a tab click can span
		// more than one panel (e.g. tab 0 -> tab 2 = 2W). The slide
		// distance is `|toTabIndex - fromTabIndex| * W` so the track
		// travels the full multi-panel span in one rAF-driven motion.
		// `restingTranslate` stays `inputs.restingTranslate` (FROM's
		// centred position = `-activeIndex * W`): progress=0 leaves FROM
		// centred, progress=1 brings TO centred at
		// `restingTranslate + sign * distance`.
		// Backward-to-higher-indexed tab: the resolver returns axis 'right'
		// (following the finger) and a single-panel distance. The host's
		// deep-snapshot overlay at activeIndex-1 covers the panel the slide
		// reveals, so the motion is exactly one panel regardless of the
		// spatial gap. Skip the multiPanel override here so its distance
		// multiplication does not stretch the slide to the full spatial
		// span. Backward-to-LOWER multi-panel (e.g. tab 2 -> tab 0 via a
		// tab-click jump then back-swipe) still takes the multiPanel path:
		// its axis is 'right' from the spatial branch, but the destination
		// is a lower index so the gap is a real multi-panel slide with no
		// overlay. The condition keys on the higher-index target so the
		// lower-index backward case is unaffected.
		const backwardToHigher =
			direction === 'backward' && inputs.fromTabIndex >= 0 && toTabIndex > inputs.fromTabIndex;
		const multiPanel =
			inputs.bidirectional === true &&
			inputs.fromTabIndex >= 0 &&
			toTabIndex >= 0 &&
			Math.abs(toTabIndex - inputs.fromTabIndex) > 1 &&
			!backwardToHigher;
		// Suppress the track slide (distance = 0) in three cases where
		// there is no panel in the slide direction on the bidirectional
		// tab host:
		// 1. Backward to a deep page from the leftmost tab (panel 0 has
		//    no left neighbour; the deep-snapshot overlay covers
		//    activeIndex >= 1). `backMorph` still drives the Header morph
		//    and `publication.progress` the FAB scale; history.back()
		//    lands on the deep page on commit.
		// 2. Within-tab pagination (e.g. `/discussions/pN` <-> `/`,
		//    either direction): both routes share the same spatial tab
		//    index and the same panel, so the panel does not change
		//    (only the page content does). Uses `getCurrentTabIndex`
		//    (pill-target-based, returns the tab index for pagination
		//    routes) rather than `toTabIndex` (`#tabIndexFor`, which
		//    returns -1 for non-tab-roots). The gesture path needs this
		//    because the click-path guard in `onSvelteKitBeforeNavigate`
		//    is not reached for gestures.
		// 3. Forward to `/search` from the last tab (the rightmost panel
		//    has no right neighbour in the 3-panel track, so a leftward
		//    slide would reveal empty space). The `/search` panel mounts
		//    in its own NavPipelineHost on commit, not in this tab-host
		//    track. The Header root<->search track still scrubs during
		//    the drag: `backMorph` and `transitionTarget='/search'` are
		//    published by `#republishToPager` independent of the slide
		//    distance, and the Header's `searchProgress` derivation
		//    consumes them; the commit dispatches `goto('/search')` and
		//    the NavPipelineHost enter slide plays on landing.
		const suppressSlide =
			(inputs.bidirectional === true &&
				inputs.fromTabIndex === 0 &&
				direction === 'backward' &&
				toData.tag !== 'tab') ||
			(inputs.bidirectional === true &&
				inputs.fromTabIndex >= 0 &&
				inputs.fromTabIndex === getCurrentTabIndex(toPathname) &&
				fromData.tag === 'tab' &&
				toData.tag === 'tab' &&
				inputs.fromPathname !== toPathname) ||
			(inputs.bidirectional === true &&
				inputs.fromTabIndex === MOBILE_TABS.length - 1 &&
				direction === 'forward' &&
				toData.tag === 'search');
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
	 *  progressStart -> progressTarget span. This keeps `backMorph`
	 *  / `tapMorph` / `fractionalIndex` (and the FAB's
	 *  `publication.progress`) continuous across the
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
		const pendingDiscreteNav = this.#pendingDiscreteNav;
		if (pendingGesture === null && pendingDiscreteNav === null) {
			// The enter-completion path: `playEnterAnimation` clears both
			// pending slots before its `onCommit`, so the enter's settle
			// reaches this branch on every forward enter (no gesture or
			// discrete nav to dispatch). Also covers a genuinely stray
			// settle (no enter, no pending transition). Land at-rest with
			// nothing to dispatch.
			this.#landAtRest();
			return;
		}
		if (progressDirection === 1) {
			// Cancel: the user released below threshold; return to rest.
			// #landAtRest dispatches any discrete nav queued by the
			// finish-then-new policy while this cancel slide was in flight.
			this.#landAtRest();
			return;
		}
		// Commit slide just reached raw = 1. Stash the FAB scale at this
		// terminal instant for the next `playEnterAnimation` to seed
		// `#enterFabAnchor`. The publication's `progress` resets 1 -> 0
		// between this point and `playEnterAnimation` (the host swap clears
		// `#progress` in `configure`, then `playEnterAnimation` re-zeroes
		// it before arming the enter settle), so without this stash the
		// FAB's value at the commit terminal would be lost across the
		// reset and the FAB layer's natural `fabScale(progress, ...)` would
		// snap from `fabScale(1, ...)` to `fabScale(0, ...)` in one rAF
		// frame at the enter's first tick (R8-A F4). The stash is cleared
		// below for a non-pipeline target (no enter will run to consume
		// it) and at `#landAtRest` / `unmount`; a pipeline target's
		// landing fires `#landAtRest` after `playEnterAnimation` consumes
		// the stash, so the lifecycle is leak-free end to end.
		this.#priorTerminalFabScale = this.#fabScaleAtSettleInstant();
		// Stash the search-axis position at the same commit-terminal instant
		// for the next `playEnterAnimation` to seed `#searchAnchor` (R23-B F2
		// sibling of the FAB stash above). Same rationale: the publication's
		// `progress` resets 1 -> 0 across the host swap, so without this stash
		// the search-axis value at the commit terminal would be lost and the
		// Header's `searchProgress` derivation would snap from the pre-boundary
		// value to the post-boundary natural value in one rAF frame.
		this.#priorTerminalSearchProgress = this.#searchProgressAtSettleInstant();
		// Commit: dispatch the SvelteKit navigation via `goto` (or
		// `history.back` / `history.forward` for a hop). The dispatch
		// sets `navDispatchInFlight` so the orchestrator's
		// `onSvelteKitBeforeNavigate` passes it through without
		// re-cancelling. At least one pending slot is non-null (the
		// both-null case returns above); both `.target` and `.to` are
		// typed `string`, so this `??` chain always yields a string at
		// runtime. The non-null assertion discharges the both-null case
		// the early return already handled.
		const target = (pendingDiscreteNav?.target ?? pendingGesture?.to)!;
		// A commit landing on a non-pipeline route never triggers the
		// orchestrator's afterNavigate hook (the singleton is not active
		// there), so clear the transient post-commit state the hook would
		// have consumed: the queued discrete nav (its finish-then-new replay
		// cannot run on a non-pipeline route), the awaitTitle settle (its
		// await cannot resolve without the landing hook), and the
		// `#priorTerminalFabScale` stash (no `playEnterAnimation` will run
		// on a non-pipeline destination to consume it; leaving the stash
		// would seed a stale `#enterFabAnchor` on the next pipeline
		// route's forward-enter - R9-B F1). The settle ease is ended
		// synchronously here because the landing hook will not run (the
		// orchestrator is not active on the destination); the morph /
		// title may snap to FROM values briefly until the goto lands, since
		// the live currentHasTabs / title are still FROM's. Pipeline targets
		// skip this: their landing fires #landAtRest, which consumes the
		// queued nav and ends the settle.
		if (!isNavPipelineRoute(target)) {
			this.#queuedDiscreteNav = null;
			this.#priorTerminalFabScale = null;
			this.#priorTerminalSearchProgress = null;
			this.#endSettleEase();
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
		// The flag is read only by a pipeline destination's
		// `notifyHeaderState` (to skip the tap-scrub arm: the commit slide
		// already drove the search-layout visual to its post-land spot).
		// Set it only for a pipeline target. A non-pipeline target has no
		// pipeline destination to read it, and the flag's clear-sites
		// (`#landAtRest` via afterNavigate, `notifyHeaderState`'s main
		// body, the supersede branch) all skip on a non-pipeline landing,
		// so an unconditional set would survive the detour and skip a
		// later tap-scrub.
		this.#lastLandWasPipelineCommit = isNavPipelineRoute(target);
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

	/** Return to at-rest, then dispatch any queued finish-then-new discrete nav. */
	#landAtRest(): void {
		const inputs = this.#mountInputs;
		// The pipeline-commit flag was set at `#dispatchNav` time so the
		// Header's `notifyHeaderState` (firing before `afterNavigate`)
		// could read it. The navigation has landed; clear the flag so a
		// later non-pipeline nav does not mis-read it as a commit.
		this.#lastLandWasPipelineCommit = false;
		// Clear the deep-to-deep handshake flag: the destination host has
		// read it in `shouldEnter` (its onMount ran before afterNavigate
		// fired this landing), so the flag's job is done. A subsequent
		// non-deep-to-deep forward nav (a tab -> deep enter) must NOT
		// inherit a stale true value.
		this.#lastDispatchWasDeepToDeep = false;
		this.#pendingGesture = null;
		this.#pendingDiscreteNav = null;
		this.#navDispatchInFlight = false;
		this.#dispatchTarget = null;
		this.#isEnterAnimation = false;
		this.#liveDragging = false;
		this.#gestureToTabIndex = null;
		// The drag ended without arming a settle; clear the morph and FAB
		// anchors so the next drag starts fresh (no stale anchor from a
		// prior settle-to-drag handoff). The prior terminal FAB scale is
		// also cleared: a cancel does not lead to a `playEnterAnimation`,
		// so the stash would otherwise leak.
		this.#dragMorphAnchor = null;
		this.#dragFabAnchor = null;
		this.#enterFabAnchor = null;
		this.#priorTerminalFabScale = null;
		this.#executor?.onLand();
		// Clear the replaceState side-channel: the intent Header.onBack set
		// must not leak to a later dispatch. #landAtRest runs on a cancel,
		// a normal landing, and immediately before a queued finish-then-new
		// replay goto, so this clear is defense-in-depth alongside the
		// onSvelteKitAfterNavigate clear. When a queued nav follows, the
		// re-arm below overwrites this clear with the queued intent so the
		// replay's #dispatchNav reads the queued value, not the cleared one.
		getMobilePagerStore().setReplaceStateIntent(false);
		if (inputs !== null) {
			this.#stateMachine.onLand(inputs.fromTag);
		}
		this.#progress = 0;
		// Fire a queued discrete navigation (the finish-then-new policy).
		// The in-flight commit completed and the nav landed; replay the
		// queued nav so `onSvelteKitBeforeNavigate` intercepts it on the
		// active host and plays the transition from progress 0. The queue
		// is consumed exactly once (cleared before the goto fires).
		//
		// Re-arm the replaceState side-channel from the queued nav before
		// the goto fires. The replay goto is intercepted by
		// `onSvelteKitBeforeNavigate`, which cancels it (discarding the
		// goto's own replaceState option) and starts a fresh slide plan;
		// that slide's eventual `#dispatchNav` reads the STORE, not the
		// queued nav. Without this re-arm the replay's dispatch would read
		// the cleared store and degrade the user's `replaceState: true`
		// intent (set by `Header.onBack`) to a push. The store is cleared
		// again when the replay slide's `#dispatchNav` `.finally` runs,
		// and again by the replay's `onSvelteKitAfterNavigate` ->
		// `#landAtRest` (no queued nav the second time, so no re-arm).
		const queuedNav = this.#queuedDiscreteNav;
		this.#queuedDiscreteNav = null;
		if (queuedNav !== null) {
			getMobilePagerStore().setReplaceStateIntent(queuedNav.replaceState === true);
			void goto(queuedNav.target, { replaceState: queuedNav.replaceState });
		}
	}

	// -----------------------------------------------------------------------
	// SvelteKit interop.

	/** Called from `+layout.svelte`'s `beforeNavigate` for pipeline-route
	 *  sources / destinations. Returns true if the orchestrator
	 *  consumed the navigation (cancelled + started a slide plan); the
	 *  layout hook does NOT also call the root layout's
	 *  `navStore.handleBeforeNavigate` in that case. */
	onSvelteKitBeforeNavigate(navigation: NavPipelineBeforeNavigateEvent): boolean {
		const inputs = this.#mountInputs;
		if (inputs === null) return false;
		const from = navigation.from?.url.pathname ?? null;
		const to = navigation.to?.url.pathname ?? null;
		// The search (?q=... etc) of the target. Kept separate from `to`
		// (pathname) because the path-based checks below (isPipelineFrom,
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
			// A navigation arriving while our own dispatch is in flight is
			// either our dispatch's re-entry (it matches #dispatchTarget below)
			// or an external nav superseding it. The supersede cancels our goto,
			// so #landAtRest (the normal clear site) never runs: clear the
			// state it would have cleared. #queuedDiscreteNav prevents a
			// phantom redirect on a later landing; #lastDispatchWasDeepToDeep
			// prevents a stale true suppressing a later forward-enter slide in
			// shouldEnter; #lastLandWasPipelineCommit prevents a stale true
			// skipping a tap-scrub arm in notifyHeaderState. The settle ease
			// was armed for the in-flight goto's landing (a commit-tick holding
			// at u=1 with awaitTitle, or a held mid-settle state); the supersede
			// cancels the goto so the awaitTitle never clears via
			// onSvelteKitAfterNavigate (skipped on a non-pipeline route), and
			// the settle rAF would tick to u=1 and hold indefinitely. End it
			// here so a stale settleActive does not leak into the next pipeline
			// route (where configure's forceReset only resets macro state, so
			// notifyHeaderState would take the mid-settle branch and snap the
			// morph instead of crossfading).
			if (!this.#isOwnDispatchReentry(to, toSearch)) {
				this.#queuedDiscreteNav = null;
				this.#lastDispatchWasDeepToDeep = false;
				this.#lastLandWasPipelineCommit = false;
				this.#endSettleEase();
			}
			return false;
		}
		if (this.#isOwnDispatchReentry(to, toSearch)) {
			return false;
		}
		// Orphan-prevention: clear a queued discrete nav (the
		// finish-then-new policy's queue) on an external nav that reached
		// here. The supersede-while-in-flight case is handled inside the
		// `#navDispatchInFlight` branch above; this clear covers an external
		// nav arriving after the goto's `.finally` cleared the in-flight flag
		// but before `#landAtRest` consumed the queue. The replay goto fired
		// from `#landAtRest` re-enters with `#navDispatchInFlight === false`
		// (cleared in `#landAtRest` before the replay fires), so it passes
		// both re-entry checks and is processed here as a fresh discrete nav;
		// by then `#landAtRest` already consumed the queue, so this clears
		// null. For the orphan case: the commit's goto was cancelled by a
		// competing external nav (session-timeout redirect, user URL,
		// app-level goto) before it landed, so `#landAtRest` never ran and
		// the queue persisted; this clear prevents the next pipeline route's
		// `#landAtRest` from firing a phantom redirect.
		this.#queuedDiscreteNav = null;
		// Only own transitions FROM the host route (a tab-click exit or
		// a back-swipe equivalent). Transitions TO the host route
		// (deep-link landings) fall through; the afterNavigate hook
		// clears the state.
		if (from === null || !this.#isPipelineFrom(inputs, from)) {
			return false;
		}
		if (to === null) return false;
		// Let the root layout hooks handle the navigation if the target
		// is also the host route (e.g. a paged conversation step within
		// the same route: `/messages/123/p1` -> `/messages/123/p2`).
		if (this.#isPipelineFrom(inputs, to)) {
			return false;
		}
		// Own transitions to a tab root (a tab-click exit) AND a
		// detail -> detail nav between two PIPELINE routes (a push like
		// /profile -> /profile/settings, or a sidebar link like
		// /messages/<id> -> /discussion/<id>). A detail -> detail nav to
		// a NON-pipeline route (e.g. /profile -> /drafts)
		// fails `isNavPipelineRoute(to)` in the isDeepToDeep check below
		// and falls through to the non-intercepted path. The
		// slide uses the 3-panel track geometry (LEFT=back-target,
		// CENTER=current, RIGHT=forward deep-to-deep destination): the
		// destination renders its skeleton in the RIGHT panel
		// (NavPipelineHost's forwardDeepTarget branch) and the
		// resolver-derived axis ('left' for a forward push) slides the
		// track so the RIGHT panel enters from the right edge.
		const toRouteData = getRouteData(to);
		const isDeepToDeep =
			!isTabRootPath(to) &&
			isNavPipelineRoute(to) &&
			inputs.fromTag === 'detail' &&
			toRouteData.tag === 'detail';
		if (!isTabRootPath(to) && !isDeepToDeep) {
			// This branch also fires for a non-intercepted PIPELINE
			// destination (e.g. `/search` from a tab/detail source: not a
			// tab root, not deep-to-deep). There the orchestrator stays
			// active and `onSvelteKitAfterNavigate` clears any in-flight
			// settle, so the manual end below is gated to a NON-pipeline
			// destination. There the nav leaves the pipeline, `releaseInputs`
			// (about to fire on the source host's destroy) ends the
			// orchestrator's active window, and the afterNavigate hook that
			// clears `awaitTitle` is gated on that window, so an in-flight
			// commit settle would strand the Header on its stale latched
			// endpoint. End the animation eases for that case (a tap-scrub
			// in flight is abandoned for the same reason); no-op when
			// nothing is in flight.
			if (!isNavPipelineRoute(to)) {
				this.#cancelAllAnimationEases();
			}
			// Clear the deep-to-deep handshake flag. The five clear sites
			// (`#landAtRest`, the supersede branch, this branch,
			// `#beginGesture`, `unmount`) cover every interruption path;
			// this branch covers a non-deep-to-deep nav arriving in the
			// pre-dispatch window (after `navigation.cancel()` armed the
			// slide on the source host but before the commit rAF reached
			// `#dispatchNav`, so `#navDispatchInFlight` is still false and
			// the supersede branch above does not fire). Without this clear
			// the flag stays true, the destination host's `shouldEnter`
			// reads it and suppresses `playEnterAnimation`, and the route
			// lands with a hard cut instead of the forward-enter slide.
			// This branch fires for every non-tab-root non-deep-to-deep
			// target, so it covers the pipeline-destination case (`/profile`
			// -> `/search`: the orchestrator stays active and `releaseInputs`
			// does not clear the flag) and the non-pipeline-destination case
			// (`/profile` -> `/drafts`: the flag would otherwise
			// survive the detour until the next mobile re-mount).
			this.#lastDispatchWasDeepToDeep = false;
			return false;
		}
		// A within-tab PAGINATION nav (e.g. `/discussions/pN` -> `/`,
		// both the discussions tab and both `tag: 'tab'`) is not a
		// tab-click exit: the panel does not change, only the page content
		// does, so there is no panel to slide in. Gate on
		// `getRouteData(from).tag === 'tab'` so a DEEP route that shares
		// the tab's index (e.g. `/discussion/<id>` -> `/`, a thread back
		// to the list) still plays its slide. `#tabIndexFor`
		// (isTabRootPath-based) returns -1 for a non-tab-root pagination
		// route, so compare via `getCurrentTabIndex` (pill-target-based).
		if (
			getCurrentTabIndex(from) >= 0 &&
			getCurrentTabIndex(from) === getCurrentTabIndex(to) &&
			getRouteData(from).tag === 'tab'
		) {
			return false;
		}
		// Finish-then-new interruption policy: a discrete navigation
		// to a tab root or deep-to-deep target (a tab-click, a
		// popstate, a link click, or a programmatic goto) arriving
		// while a commit slide is in flight (a gesture commit, a
		// prior tab-click commit, a forward-enter, or a cancel slide;
		// the executor's onCancel delegates to onCommit with
		// progressDirection 1, so phase === 'committing' holds here)
		// accelerates the in-flight to completion, then replays the
		// queued nav on the landed host so its transition plays from
		// progress 0. The finger-controlled drag path (#beginGesture)
		// keeps the current behavior (track the finger from the current
		// visual). The live-drag phase (executor phase 'live') is not
		// accelerated: a finger is still controlling the track, so the
		// discrete nav falls through to the from-visual handoff below.
		//
		// Capture-clear: read the replaceState intent from the pager
		// store into the queue (so it survives the in-flight commit's
		// landing) AND clear the store immediately. The clear is
		// required because the in-flight commit's settle will call
		// `#dispatchNav(commitTarget)` next, which reads the store for
		// its own goto options; if the intent remained, the COMMIT's
		// target would dispatch with `replaceState: true` applied to
		// the wrong URL. `#landAtRest` re-arms the store from the
		// queue before the replay goto so the replay's `#dispatchNav`
		// reads the correct intent. The goto's own `replaceState`
		// argument is discarded by `navigation.cancel()` below, so the
		// store (not the goto options) is the only path that preserves
		// the intent through the replay.
		if (this.#executor?.state.phase === 'committing') {
			this.#accelerateInFlight();
			const queuedReplaceState = getMobilePagerStore().replaceStateIntent;
			getMobilePagerStore().setReplaceStateIntent(false);
			this.#queuedDiscreteNav = {
				target: to + toSearch,
				replaceState: queuedReplaceState
			};
			navigation.cancel();
			return true;
		}
		// Cancel any running settle / tap-scrub ease so a
		// tab-click or deep-to-deep nav arriving while a settle is still
		// running does not leave that settle's rAF ticking
		// underneath the new slide. Matches `#beginGesture`'s gesture-path
		// behavior (a re-grab mid-transition cancels every ease before
		// starting the drag). Skipped on the `phase === 'committing'`
		// branch above: that path accelerates the in-flight commit
		// (settle included) instead of starting a fresh slide.
		this.#cancelAllAnimationEases();
		// A discrete nav (tab-click exit or deep-to-deep). Drive the
		// slide plan via the executor and dispatch on settle. The
		// direction: a deep-to-deep is a push ('forward') or a pop
		// ('backward') per `navigation.type`; a tab-click is forward
		// only when the target tab is at a higher index than the source
		// (bidirectional host), else backward.
		const toPathname = to;
		const toTabIndex = this.#tabIndexFor(toPathname);
		const direction: TransitionDirection = isDeepToDeep
			? navigation.type === 'popstate'
				? 'backward'
				: 'forward'
			: inputs.bidirectional === true && toTabIndex > inputs.fromTabIndex
				? 'forward'
				: 'backward';
		// Synthesize a "tap" intent so the resolver produces a commit plan.
		const intent = {
			...initialIntentState(),
			micro: 'committed' as const,
			target: toPathname,
			startedAt: this.#clock()
		};
		const resolvedPlan = this.#resolvePlan(inputs, intent, direction, toPathname, toTabIndex);
		// The host's track is 3 panels (LEFT=back-target, CENTER=current,
		// RIGHT=forward deep-to-deep destination). The {detail,detail}
		// resolver returns axis='left' for a forward push (the new page
		// enters from the right edge); NavPipelineHost renders the
		// destination skeleton in the RIGHT panel (its forwardDeepTarget
		// branch), so the resolver's native axis is correct with no
		// override. A backward deep-to-deep returns axis='right' and
		// reveals the LEFT panel (the back-target).
		const plan = resolvedPlan;
		// Capture the in-flight drag's target BEFORE the resets below clear
		// `#pendingGesture`. The helper `#dragMorphAtSettleTakeover` (called
		// below) classifies the DRAG's shape (mirroring the Header's drag
		// branch, which reads the live `bm` and the drag's plan), so its
		// `incomingHasTabs` / `targetIsSearch` parameters must be sourced
		// from the drag's target, not the discrete-nav's destination. When
		// the drag's target has different tab-ness than the discrete-nav
		// destination (the R22-A shapes), sourcing from `toPathname`
		// misclassifies the drag and the settle-arm condition evaluates
		// false, snapping the morph at the drag-to-discrete-nav handoff.
		// `null` when no drag was in flight at the interrupt (the from-rest
		// tab-click case); the helper's parameters collapse to
		// `outgoingHasTabs` / `false` in that case (the source host's
		// tab-ness with no search target), matching the from-rest at-rest
		// behaviour of the helper's output (R22-A safe-by-construction).
		// Mirrors the gesture-release site `#armSettleEaseFromGesture`,
		// which reads `pending.to` for the same parameters (R22-A sibling).
		const dragTargetPathname = this.#pendingGesture?.to ?? null;
		this.#pendingGesture = null;
		this.#liveDragging = false;
		this.#gestureToTabIndex = toTabIndex;
		// The full URL (pathname + search) so a tab-click to e.g. /?q=foo
		// dispatches to that exact URL, not the bare pathname.
		this.#pendingDiscreteNav = { target: to + toSearch };
		// Arm the deep-to-deep handshake flag so the destination host's
		// `shouldEnter` suppresses `playEnterAnimation` (the slide was
		// already animated on this source host). Cleared in `#landAtRest`
		// after the destination mounts; see `#lastDispatchWasDeepToDeep`.
		this.#lastDispatchWasDeepToDeep = isDeepToDeep;
		this.#navDispatchInFlight = false;
		this.#dispatchTarget = null;
		navigation.cancel();
		// Compute the new plan's progress at the current visual position
		// BEFORE we touch the executor or `#progress`. The discrete nav
		// can interrupt a live drag whose FROM/TO differ from this nav's
		// (an opposite-direction tab-click arriving mid-finger-drag, or a
		// deep-to-deep forward nav interrupting a backward drag on a deep
		// host): the same visual then maps to a raw value in the new
		// direction's frame that differs from `this.#progress`, and the
		// two can be related by `raw_new = 1 - raw_old` (or an
		// extrapolated value outside [0, 1] when the visual falls outside
		// the new plan's span). Seed `#commitStartRaw` from this
		// visual-derived `startProgress` so the commit-phase publication
		// (which lerps from `#commitStartRaw` toward `cs.progressTarget`
		// in `#onExecutorTick`) stays in lockstep with the track translate
		// (which `executor.onDragStart` seeds from the same
		// `startProgress`). Seeding from `this.#progress` instead would
		// publish a raw already past the midpoint at frame 1 of the
		// commit (the FAB jumps and the morph saturates before the
		// slide's first eased step). `#publish` clamps the raw it writes
		// so an extrapolated `startProgress` (a reverse-direction
		// interrupt on the bidirectional host) cannot push
		// `publication.progress` / `pager.backMorph` outside [0, 1].
		const startProgress = this.#startProgressFromCurrentVisual(plan);
		this.#commitStartRaw = startProgress;
		this.#isEnterAnimation = false;
		// Capture the morph the Header's drag branch was rendering at the
		// interrupt instant BEFORE the resets below zero `#progress` and
		// `#armSettleEase` clears `#dragMorphAnchor`. The discrete nav can
		// arrive during a live drag (including one that took over an
		// in-flight settle: re-grab, gesture-during-forward-enter): the
		// drag's terminal morph is computed by `#dragMorphAtSettleTakeover`
		// from the LIVE `#publication.progress` (the drag's raw on its own
		// plan scale, which is what `bm` in the Header's drag branch reads
		// via `pager.backMorph`). The helper returns the anchor-shifted
		// natural(raw) for shapes where the drag branch follows `bm`
		// (centerTab thread -> tab-root, deep -> tab, tab -> deep) via
		// `#dragMorphAtAnchorOrRaw`, AND returns `anchor.morph` directly
		// for the `dragMorphWasStatic` shapes (targetIsSearch, non-centerTab
		// tab-to-tab) whose drag branch holds the morph at the anchor when
		// a re-grab took over an in-flight settle (R8-A F1 / F2); without
		// the anchor-aware path the new settle's `startMorph` would default
		// to `atRestMorph(outgoing)` and the morph would snap from
		// `anchor.morph` to the at-rest in one rAF frame. `liveDragMorph`
		// feeds the settle's `startMorph` below so the morph continues from
		// the visual the Header was rendering at the interrupt (DV21 §5
		// "following-visual" at the drag-to-discrete-nav handoff). The
		// shape classification mirrors the Header's drag branch end-to-end
		// via the shared `#dragMorphAtSettleTakeover` helper that
		// `#armSettleEaseFromGesture` also calls at release. Symmetric to
		// how `#beginGesture` captures `settleMorphAtTakeover` before
		// `#cancelAllAnimationEases` and how `#armSettleEaseFromGesture`
		// reads the live `#publication.progress` at release: every
		// drag<->settle handoff captures the morph the visual was rendering
		// at the takeover instant.
		// Helper parameters describe the DRAG's shape (the in-flight drag's
		// plan), not the discrete-nav's destination: the Header's drag branch
		// reads the live `bm` and the drag's plan endpoints, and the helper
		// mirrors that branch end-to-end, so its `incomingHasTabs` /
		// `targetIsSearch` must be sourced from the drag's target
		// (`dragTargetPathname`, captured above before the resets). When the
		// drag's target has different tab-ness than the discrete-nav
		// destination (the R22-A shapes), sourcing these from `toPathname`
		// misclassifies the drag and the settle-arm condition evaluates false,
		// snapping the morph at the drag-to-discrete-nav handoff. The
		// collapse-when-no-drag fallbacks (`outgoingHasTabs` for
		// `incomingHasTabs`, `false` for `targetIsSearch`) are safe for the
		// helper's output: at raw=0 with no anchor the helper returns
		// `atRestMorph(outgoingHasTabs)` regardless of `incomingHasTabs`
		// (except for the `isDeepToDeep` short-circuit, which also returns
		// `atRestMorph(false) = 0`); the helper's output therefore matches
		// the from-rest at-rest morph whether or not a drag was in flight.
		const liveDragMorphOutgoingHasTabs = inputs.fromTabIndex >= 0;
		const liveDragMorphIncomingHasTabs =
			dragTargetPathname !== null
				? getCurrentTabIndex(dragTargetPathname) >= 0
				: liveDragMorphOutgoingHasTabs;
		const liveDragMorphIsCenterTabRoute = inputs.centerTab !== undefined;
		const liveDragMorphTargetIsSearch =
			dragTargetPathname !== null && resolveHeaderMode(dragTargetPathname) === 'search';
		const liveDragMorph = this.#dragMorphAtSettleTakeover(
			liveDragMorphOutgoingHasTabs,
			liveDragMorphIncomingHasTabs,
			liveDragMorphIsCenterTabRoute,
			liveDragMorphTargetIsSearch,
			this.#publication.progress
		);
		// Capture the FAB scale the drag was rendering at the interrupt
		// instant BEFORE the state-machine dispatch and `#progress = 0`
		// reset below (DV21 §5 sibling-visual rule: the FAB tier needs the
		// same drag-terminal capture the morph tier made above as
		// `liveDragMorph`). The helper reads the LIVE `#publication` (the
		// drag's raw on its own plan, the drag's FROM/TO endpoints, the
		// live `#dragFabAnchor` / `#enterFabAnchor`), so the captured value
		// mirrors whatever branch the FAB layer was rendering at the last
		// drag frame (dragAnchor shift, enterAnchor lerp, boundary,
		// suppressed, or natural formula). Co-located with `liveDragMorph`
		// so the morph and FAB captures cannot drift apart at the boundary
		// (R14 F1): the capture must read the drag's plan scale and
		// endpoints, not the post-reset post-dispatch values the new
		// settle will operate on. For a from-rest tab-click (no live drag)
		// the publication is at rest at the capture moment, so
		// `#fabScaleAtSettleInstant` returns `null` (its `!pub.inFlight`
		// guard short-circuits); the re-seed below's
		// `if (capturedFabScale !== null)` guard skips, leaving
		// `#enterFabAnchor` null so the FAB layer reads branch 5 (the
		// natural `fabScale(progress, ...)` formula) end-to-end across
		// the settle. For a re-grab (a drag that took over an in-flight settle,
		// so `#dragFabAnchor` was set) the capture mirrors the
		// dragAnchor-shifted value the FAB layer was rendering at the
		// interrupt, and the re-seed lerps from that value to the
		// destination's at-rest FAB scale across `settleMorphFraction`
		// (R12-B F1 sibling at the drag-to-discrete-nav handoff).
		// Symmetric to `#armSettleEaseFromGesture`, which captures the
		// drag-terminal FAB value before its arm for the release-settle
		// handoff (R12-B F1).
		const liveDragFabScale = this.#fabScaleAtSettleInstant();
		// Capture the search-axis position the drag was rendering at the
		// interrupt instant BEFORE the state-machine dispatch and
		// `#progress = 0` reset below (DV21 §5 sibling-visual rule: the
		// search axis needs the same drag-terminal capture the morph and
		// FAB tiers made above). Co-located with `liveDragMorph` and
		// `liveDragFabScale` so the three captures cannot drift apart at
		// the boundary. The helper mirrors the Header's `searchProgress`
		// derivation end-to-end via the LIVE `#publication` (the drag's
		// raw on its own plan, the drag's FROM/TO endpoints), so for a
		// forward-swipe-to-`/search` interrupted by a non-search goto it
		// returns the live `bm` (the panel is `bm` of the way in). For a
		// from-rest tab-click (no live drag, no in-flight transition) the
		// helper returns the at-rest searchProgress (`isSearch(source) ?
		// 1 : 0`); the re-seed below's `if (capturedSearchProgress !==
		// null)` guard skips when no transition was in flight at the
		// capture (the helper's `pub.inFlight` short-circuit), leaving
		// `#searchAnchor` null so the Header's natural `searchProgress`
		// derivation handles the discrete-nav settle.
		const liveDragSearchProgress = this.#searchProgressAtSettleInstant();
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
		// The slide uses the host's 3-panel geometry (LEFT=back-target,
		// CENTER=current, RIGHT=forward deep-to-deep destination); the
		// host renders the back-target's real panel (cached) or its
		// skeleton in the LEFT slot and the destination's skeleton in the
		// RIGHT slot for a forward deep-to-deep, so the slide reveals the
		// correct content. Dispatch on settle.
		this.#executor?.onDragStart(plan, startProgress);
		// No finger-release velocity on a tab-click: pass 0 and let the
		// velocity-matched solver pick the default duration
		// (`COMMIT_T_DEFAULT_MS`).
		this.#executor?.onCommit(0);
		this.#stateMachine.onCommit();
		// Arm the settle ease CONCURRENTLY with the slide when the morph
		// will visibly change between the live drag's terminal value and
		// the at-rest value the morph derivation would otherwise resolve
		// to. Three reach paths:
		//  1. The source and target tab-ness differ (the deep↔tab case:
		//     a tab-click exit, the back-button from a deep page to its
		//     tab root, a cross-tab bidirectional click). The morph drives
		//     the root-layer `translateY` (the tab bar descent) and the
		//     title-layer `translateY`, both of which must overlap with
		//     the page slide per Bug 7 (no sequential gap).
		//  2. A live drag advanced the morph away from the SOURCE's
		//     at-rest (a centerTab thread -> tab-root back-swipe
		//     interrupted by a `__e2eGoto('/')`; the source and
		//     destination both have `hasTabs = true` so the at-rests
		//     agree, but the live `liveDragMorph` differs from that
		//     value). Skipping the settle would leave the morph
		//     derivation's at-rest branch to return the SOURCE's at-rest
		//     morph in one rAF frame at the drag-to-discrete-nav handoff
		//     (DV21 §5: no snap at any boundary).
		//  3. A saturated drag on a tab-ness-changing shape (e.g. a
		//     `/messages/<id>` centerTab saturated back-swipe interrupted
		//     by `goto('/bookmarks')`, or a `/profile/settings` deep
		//     saturated back-swipe interrupted by `goto('/messages/inbox')`).
		//     At raw=1 the drag branch's terminal morph equals the
		//     destination's at-rest morph by construction
		//     (`1 - raw = 0 = atRestMorph(false)` for centerTab -> deep,
		//     `raw = 1 = atRestMorph(true)` for deep -> tab), so the
		//     `liveDragMorph !== destMorph` clause is false; but the
		//     at-rest branch still returns the SOURCE's at-rest morph
		//     (the URL has not changed yet, so `currentHasTabs` is the
		//     source's), so the morph snaps unless the settle fires.
		// The condition
		// `liveDragMorph !== sourceRest || liveDragMorph !== destMorph`
		// covers all three: case (1) with no live drag has
		// `liveDragMorph === sourceRest === atRestMorph(outgoing)` and
		// the second clause fires because the at-rests differ; case (2)
		// fires on the first clause (live !== source) regardless of the
		// destination; case (3) fires on the first clause for the same
		// reason. The from-rest same-tab-ness shape (no live drag, no
		// tab-ness change) collapses to equality on both clauses and
		// skips the arm: a non-centerTab tab -> tab discrete nav on the
		// bidirectional host interpolates the pill highlight via
		// `pager.fractionalIndex` (a separate field the orchestrator
		// publishes per frame, not the morph), and a deep->deep discrete
		// nav arms its title crossfade AT THE NAVIGATION LANDING via
		// `notifyHeaderState`'s idle title-change arm with
		// `TITLE_CROSSFADE_MS` (200ms). Arming the morph settle here for
		// the deep->deep shape would run the settle's 300ms
		// `commitStart.durationMs` cycle during the slide, reach u=1 with
		// `awaitTitle: true` right when the URL lands, and
		// `notifyHeaderState`'s mid-settle branch would `#endSettleEase()`
		// immediately, collapsing the 2-span crossfade to 1
		// (`e2e/reproduce-user-bugs.spec.ts` Bug 10). The deep->deep
		// short-circuit in the `liveDragMorph` capture above keeps the
		// deep->deep drag (anchor or not) on the equality branch.
		// The settle uses the same pattern `playEnterAnimation` and
		// `#armSettleEaseFromGesture` use for the forward-enter and
		// gesture-commit slides: velocity-matched to the slide via
		// `commitStart.durationMs`, `awaitTitle: true` so the settle
		// holds at progress 1 once the rAF reaches u=1, cleared by the
		// navigation landing via `onSvelteKitAfterNavigate` (and
		// `notifyHeaderState`'s mid-settle branch absorbs the destination
		// title when it arrives, matching the gesture-commit path's
		// land-clear).
		// Outgoing = the source host route (the live `#prevHeaderTitle`,
		// captured before the destination's `$effect.pre` flips it; mirrors
		// `#armSettleEaseFromGesture`, which also runs on the SOURCE host
		// pre-landing). Incoming = the destination via the static resolver
		// (the live destination title is not available until the route
		// mounts; a dynamic-title destination resolves to '' here, and if
		// the live title then differs from the latched incoming,
		// `notifyHeaderState`'s mid-settle re-arm picks it up without a
		// snap - the same handoff the gesture-release path relies on).
		const settleT = this.#headerT;
		if (settleT !== null && this.#executor !== null) {
			const outgoingHasTabs = inputs.fromTabIndex >= 0;
			// Two `incomingHasTabs` values, decoupled because they serve two
			// different consumers with different continuity requirements.
			//
			// `destMorphIncomingHasTabs` (sourced from `toPathname`, the
			// discrete-nav dest) drives `destMorph =
			// atRestMorph(destMorphIncomingHasTabs)`: the morph value the
			// settle eases TOWARD across `settleMorphFraction`. At the settle
			// end the URL has landed on the discrete-nav's destination, so the
			// post-landing at-rest morph is `currentHasTabs(destPathname) ?
			// 1 : 0`; `destMorph` must equal that or the morph snaps at the
			// landing boundary.
			//
			// `latchedIncomingHasTabs` feeds the Header's `tabsIn` derivation
			// via `settleLatched.incomingHasTabs`. The layer guard
			// `!(tabsOut || tabsIn)` decides whether the morph-based
			// `translateY` formula applies (guard false) or the layers freeze
			// at the dest's at-rest (guard true). During the settle the morph
			// eases from the drag's terminal value toward `destMorph`, so the
			// layers must follow morph end-to-end (guard false) whenever the
			// morph trajectory passes through non-deep-at-rest values. The
			// trajectory does so when EITHER the drag's target OR the
			// discrete-nav dest is a tab:
			//  - Shape (F,F,T) (deep source, deep discrete-nav dest, tab drag
			//    target): morph eases from the drag's terminal (~0.37) TO
			//    `destMorph = 0`; sourcing tabsIn from only the dest (false)
			//    would freeze the layers at `-100%` while morph is mid-ease
			//    (~14.66px snap at the first settle frame).
			//  - Shape (F,T,F) (deep source, tab discrete-nav dest, deep drag
			//    target): morph eases FROM `startMorph = 0` to `destMorph = 1`;
			//    sourcing tabsIn from only the drag's target (false) would
			//    freeze the layers at `-100%` while morph rises and snap to
			//    `0%` at the landing boundary.
			// The OR of the two endpoints' tab-ness is the minimal predicate
			// that covers both: `dragTargetIncomingHasTabs ||
			// destMorphIncomingHasTabs`. Deep-to-deep (both endpoints deep)
			// collapses to false: morph stays at 0 end to end and the layer
			// freeze is correct. From-rest (`dragTargetPathname === null`)
			// collapses `dragTargetIncomingHasTabs` to false, so
			// `latchedIncomingHasTabs === destMorphIncomingHasTabs` (the
			// from-rest tab-click case: both endpoints reflect the
			// discrete-nav dest, so the layer guard and `destMorph` agree).
			const destMorphIncomingHasTabs = getCurrentTabIndex(toPathname) >= 0;
			const dragTargetIncomingHasTabs =
				dragTargetPathname !== null && getCurrentTabIndex(dragTargetPathname) >= 0;
			const latchedIncomingHasTabs = dragTargetIncomingHasTabs || destMorphIncomingHasTabs;
			const sourceRest = this.#atRestMorph(outgoingHasTabs);
			const destMorph = this.#atRestMorph(destMorphIncomingHasTabs);
			if (liveDragMorph !== sourceRest || liveDragMorph !== destMorph) {
				const outgoingTitle = this.#prevHeaderTitle;
				const incomingTitle = resolveDeepHeaderTitle(toPathname, settleT) ?? '';
				// `startMorph` is the morph captured above from the live
				// drag. `#dragMorphAtSettleTakeover` returns the
				// anchor-shifted natural(raw) for shapes where the drag
				// branch follows `bm` (the audit's centerTab thread ->
				// tab-root shape, deep -> tab, tab -> deep) via
				// `#dragMorphAtAnchorOrRaw`; returns `anchor.morph`
				// directly for the `dragMorphWasStatic` shapes
				// (targetIsSearch, non-centerTab tab-to-tab) when a
				// re-grab took over an in-flight settle (R8-A F1 / F2: the
				// drag branch holds the morph at the anchor in those
				// shapes, so the new settle's `startMorph` must mirror
				// that or the morph snaps to the at-rest at the
				// drag-to-settle handoff); returns the at-rest morph for
				// the from-rest case of every shape; and hardcodes 0 for
				// deep-to-deep. The settle eases from `startMorph` to
				// `destMorph = atRestMorph(incomingHasTabs)` so the morph
				// matches the drag's terminal value at the first settle
				// frame and arrives at the destination's at-rest at u=1.
				// Symmetric to `#armSettleEaseFromGesture`, which captures
				// the live raw at release for the same reason (DV21 §5:
				// no snap at the drag-to-discrete-nav handoff).
				const startMorph = liveDragMorph;
				const latched: HeaderSettleTransition = {
					outgoingTitle,
					incomingTitle,
					outgoingHasTabs,
					incomingHasTabs: latchedIncomingHasTabs,
					startMorph,
					destMorph
				};
				const commitDurationMs = this.#executor.state.commitStart?.durationMs ?? TITLE_CROSSFADE_MS;
				// `direction` is a TransitionDirection ('forward' | 'backward');
				// the settle enum is 'forward' | 'back'. Mirror the gesture-release
				// path's conversion in `#armSettleEaseFromGesture`.
				const settleDirection = direction === 'forward' ? 'forward' : 'back';
				// `startProgress` (the visual-derived raw at the interrupt,
				// computed above via `#startProgressFromCurrentVisual`) seeds
				// `settleStartProgress` so the settle's raw-scale `settleProgress`
				// starts at the live drag raw the title spans read at the
				// handoff. The title spans read `settleProgress` directly via
				// `titleView.progress` during a settle and `pager.backMorph`
				// during a drag, both on the same raw scale; seeding
				// `settleStartProgress = startProgress` keeps the first settle
				// frame's `settleProgress` equal to the drag's terminal
				// `pager.backMorph`, so the outgoing / incoming title
				// `translateY` is continuous across the drag-to-discrete-nav
				// handoff (DV21 §5). The from-rest tab-click path collapses to
				// `startProgress = 0` (no live drag owns the visual), so
				// Bug 7's from-rest discrete-nav behaviour is preserved.
				// Symmetric to `#armSettleEaseFromGesture`, which passes
				// `this.#publication.progress` (the live raw at release) for
				// the same parameter so the title spans stay continuous at the
				// gesture-release handoff.
				// `liveDragFabScale` was captured alongside `liveDragMorph`
				// BEFORE the state-machine dispatch and `#progress = 0`
				// reset above, so it reads the drag's live raw on the drag's
				// plan scale and endpoints (R14 F1). `#armSettleEase` does
				// not modify the value: the capture is a local, not a
				// publication read, so it is invariant across the arm. The
				// re-seed's `dest` is the destination's at-rest FAB presence
				// (`toHasFab ? 1 : 0`; the discrete-nav arm always targets
				// `settleTargetProgress = 1`); for a from-rest tab-click the
				// publication is at rest at the capture moment, so
				// `#fabScaleAtSettleInstant` returns `null` (its
				// `!pub.inFlight` guard short-circuits) and the re-seed's
				// `if (capturedFabScale !== null)` guard skips, leaving
				// `#enterFabAnchor` null so the FAB layer reads branch 5
				// (the natural `fabScale(progress, ...)` formula)
				// end-to-end across the settle. For a re-grab the
				// captured value is the dragAnchor-shifted value the FAB
				// layer was rendering at the interrupt; the re-seed lerps
				// from that value to the destination's at-rest FAB scale
				// across `settleMorphFraction` (R12-B F1 sibling at the
				// drag-to-discrete-nav handoff).
				const capturedFabScale = liveDragFabScale;
				const capturedSearchProgress = liveDragSearchProgress;
				this.#armSettleEase(latched, startProgress, 1, true, settleDirection, commitDurationMs);
				// Re-seed `#enterFabAnchor` AFTER the arm so the FAB
				// layer's branch 3 lerps from the captured drag-terminal
				// value to the destination's at-rest FAB scale across
				// `settleMorphFraction` (mirrors the gesture-release
				// re-seed in `#armSettleEaseFromGesture`, R12-B F1).
				if (capturedFabScale !== null) {
					const toHasFab = getRouteData(toPathname).fab;
					this.#enterFabAnchor = { start: capturedFabScale, dest: toHasFab ? 1 : 0 };
				}
				// Re-seed `#searchAnchor` AFTER the arm so the Header's
				// `searchProgress` derivation lerps from the captured
				// drag-terminal value to the destination's at-rest
				// searchProgress across `settleMorphFraction` (R23-B F1).
				// `dest` is the discrete-nav dest's at-rest searchProgress
				// (`isSearch(dest) ? 1 : 0`): the settle ends with the URL
				// landed on the dest, so the post-settle natural
				// `searchProgress` is the dest's at-rest value, and the
				// lerp must match it to avoid a snap at the settle end.
				// For the audit's flagship (F,F,*) shape (a
				// forward-swipe-to-`/search` interrupted by a non-search
				// `goto`), `capturedSearchProgress` is the drag's live `bm`
				// (e.g. 0.43) and `dest` is 0, so the lerp retreats the
				// search panel from `bm` to 0 across the discrete-nav
				// settle. For a from-rest tab-click (no live drag) the
				// helper returned null and the re-seed skips; the Header's
				// natural `searchProgress` derivation handles the settle.
				if (capturedSearchProgress !== null) {
					const destSearch = resolveHeaderMode(toPathname) === 'search' ? 1 : 0;
					this.#searchAnchor = { start: capturedSearchProgress, dest: destSearch };
				}
			}
		}
		return true;
	}

	/** Called from `+layout.svelte`'s `afterNavigate` for pipeline-route
	 *  sources / destinations. For a host-internal param navigation
	 *  (`/messages/123/p1` -> `/messages/123/p2`) or the initial arrival this is a
	 *  no-op reset (the orchestrator is at rest). For a pipeline-to-pipeline
	 *  route swap (a tab-click exit / a gesture settle to another pipeline
	 *  host), the new host's `configure` re-sets `active` (and `#mounted`)
	 *  before `afterNavigate` fires, so this call runs through and
	 *  `#landAtRest` clears the pending slots on the freshly configured host.
	 *  For a navigation AWAY from the pipeline entirely (to a non-pipeline
	 *  route where no host mounts), the host's `onDestroy` runs before
	 *  `afterNavigate` (Svelte 5 lifecycle: old `onDestroy` -> new route
	 *  mounts -> `afterNavigate`), the active slot is already null, and this
	 *  call is skipped; the cleanup is handled by `onDestroy` ->
	 *  `releaseInputs()`.
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
			(this.#pendingGesture !== null || this.#pendingDiscreteNav !== null)
		) {
			return;
		}
		this.#landAtRest();
	}

	#isPipelineFrom(inputs: PipelineMountInputs, from: string): boolean {
		// The host's own pathname. Compare by prefix so a paged URL
		// (`/messages/123/p2`) still counts as the same host.
		const hostPath = inputs.fromPathname.replace(/\/p\d+$/, '');
		const fromStripped = from.replace(/\/p\d+$/, '');
		return hostPath === fromStripped;
	}

	/** True if a `beforeNavigate` (`to` pathname + `toSearch`) is the
	 *  orchestrator's own in-flight dispatch re-entering. `#dispatchTarget`
	 *  is the gesture target's PATHNAME (`pendingGesture.to`, which derives
	 *  from `previousEntryPathname` / `backTarget`, both search-stripped) or
	 *  the discrete nav's FULL URL (`pendingDiscreteNav.target = to +
	 *  toSearch`). Accept either: a gesture commit dispatched via
	 *  `history.back()` re-enters with the verbatim history entry's search,
	 *  which the pathname-only gesture target cannot match by full URL, so a
	 *  pathname match is also accepted. (A same-pathname external nav during
	 *  a gesture dispatch could match the pathname clause; the leak is
	 *  bounded by the supersede branch clearing `#queuedDiscreteNav` and
	 *  `#landAtRest` consuming it. A gesture dispatch CAN carry
	 *  `#queuedDiscreteNav` if a tab-click interrupted mid-commit via the
	 *  finish-then-new policy, so the bound is the defense-in-depth clears,
	 *  not the dispatch being queue-free.) */
	#isOwnDispatchReentry(to: string | null, toSearch: string): boolean {
		if (this.#dispatchTarget === null || to === null) return false;
		return to === this.#dispatchTarget || to + toSearch === this.#dispatchTarget;
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
		// The drag's morph / FAB anchors (if any) are no longer relevant;
		// clear so the next drag starts fresh. The enter FAB anchor is also
		// cleared here as the canonical single-site reset; callers that need
		// to preserve the FAB's in-flight visual across this arm re-seed the
		// anchor AFTER this method returns. Five re-seeding callers:
		//   - `playEnterAnimation` (commit-to-enter handoff, R8-A F4):
		//     stashes the prior terminal scale into
		//     `#priorTerminalFabScale` and re-seeds from it.
		//   - `#accelerateInFlight` (discrete-nav interrupt of an
		//     in-flight settle, R10-A F1): captures the live FAB value
		//     via `#fabScaleAtSettleInstant` (non-null: the commit slide
		//     is in flight at the accelerate instant, so
		//     `pub.inFlight === true`) and re-seeds from that; the
		//     re-seed's skip guard is `prevEnterFabAnchor !== null`, so
		//     for an anchor-set settle being accelerated (gesture-
		//     release, discrete-nav, mid-settle absorb, R12-B F1
		//     siblings that set `#enterFabAnchor`) the FAB layer reads
		//     branch 3 (enterAnchor lerp) and the re-seed is required
		//     for boundary continuity, while for a path that left
		//     `#enterFabAnchor` null at the arm (from-rest discrete-nav
		//     or fresh-enter) the guard skips the re-seed and the FAB
		//     layer reads branch 5 end-to-end.
		//   - `#armSettleEaseFromGesture` (gesture release, R12-B F1):
		//     captures the live FAB value via `#fabScaleAtSettleInstant`
		//     and re-seeds from that for every release; for symmetric
		//     shapes the re-seed is a no-op for the visual but still
		//     correct, for asymmetric shapes (from-only-FAB, to-only-FAB,
		//     boundary, suppressed) it is the only continuity guard.
		//   - The `onSvelteKitBeforeNavigate` discrete-nav arm (tab-click
		//     / `goto` / popstate interrupt of an in-flight drag or
		//     settle, R12-B F1 sibling): captures the live FAB value via
		//     `#fabScaleAtSettleInstant` and re-seeds from that; for a
		//     from-rest tab-click the publication is at rest at the
		//     capture moment, so `#fabScaleAtSettleInstant` returns
		//     `null` (its `!pub.inFlight` guard short-circuits) and the
		//     re-seed's `if (capturedFabScale !== null)` guard skips,
		//     leaving `#enterFabAnchor` null so the FAB layer reads
		//     branch 5 (the natural `fabScale(progress, ...)` formula)
		//     end-to-end across the settle; for a re-grab it mirrors the
		//     dragAnchor-shifted value the FAB layer was rendering.
		//   - The `notifyHeaderState` mid-settle absorb (a dynamic-title
		//     route resolves a new title mid-enter, R12-B F1 sibling):
		//     captures the live FAB value via `#fabScaleAtSettleInstant`
		//     and re-seeds from that; for an anchor-set non-enter
		//     settle being re-armed (gesture-release, discrete-nav,
		//     accelerate-in-flight) the FAB layer reads branch 3 and
		//     the re-seed is required for boundary continuity, while
		//     for the idle title-change arm (from-rest same-tab-ness
		//     navs) the capture returns null and the null-guard skips
		//     the re-seed.
		// The clear and any post-arm re-seed happen in the caller's same
		// synchronous block, so Svelte's reactive flush sees only the
		// re-seeded `#enterFabAnchor`: the FAB layer's `$derived` re-runs
		// once on the next microtask, reading branch 3 with the re-seeded
		// anchor and `settleEasedFraction = 0` (reset above), which equals
		// the captured value the caller stashed, continuous with the
		// pre-arm displayed value. The natural `fabScale(progress, ...)`
		// formula is NOT what the FAB layer reads here; for the
		// `enterFabAnchor`-set shapes (branch 3) it disagrees with the
		// displayed value, which is exactly why the re-seed is required.
		this.#dragMorphAnchor = null;
		this.#dragFabAnchor = null;
		this.#enterFabAnchor = null;
		this.#settleStartProgress = startProgress;
		this.#settleTargetProgress = targetProgress;
		this.#settleAwaitTitle = awaitTitle;
		// Seed the eased-fraction at 0 so the morph derivation reads
		// `startMorph` on the first post-arm flush (continuity with the
		// drag's terminal value, captured as `latched.startMorph`). The
		// rAF advances this field to 1 across `safeDuration`.
		this.#settleEasedFraction = 0;
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
			this.#settleEasedFraction = 1;
			this.#stateMachine.setSettleState({ progress: targetProgress });
			if (!awaitTitle) this.#endSettleEase();
			return;
		}
		this.#settleStartTs = 0;
		// Last progress published by the rAF. Seeded at the arm value so
		// the first tick's clamp is measured from the start. Captured in
		// the tick closure (not read back from the state machine) so the
		// rAF owns its own per-tick delta computation without coupling to
		// the publication's read path.
		let lastProgress = startProgress;
		const tick = (): void => {
			const now = this.#clock();
			if (this.#settleStartTs === 0) this.#settleStartTs = now;
			const u = Math.min((now - this.#settleStartTs) / safeDuration, 1);
			const eased = commitEase(u);
			// Publish the eased timeline so the morph derivation animates
			// `startMorph -> destMorph` across the full settle duration,
			// even when `settleStartProgress === settleTargetProgress`
			// (a drag that saturated before release). The title spans read
			// `settleProgress` directly and remain continuous via the
			// raw-scale publish below.
			this.#settleEasedFraction = eased;
			const desiredProgress =
				this.#settleStartProgress +
				(this.#settleTargetProgress - this.#settleStartProgress) * eased;
			// Per-tick clamp (see `settlePerTickCap` in nav-executor-logic):
			// caps the single-tick advance so a delayed first rAF tick
			// under main-thread load cannot pop the Header morph / title
			// crossfade. Same policy as the executor's commit rAF; one
			// source of truth for the clamp across every animation channel
			// that uses `commitEase`.
			const span = Math.abs(this.#settleTargetProgress - this.#settleStartProgress);
			const cap = settlePerTickCap(safeDuration, span);
			const delta = desiredProgress - lastProgress;
			const clampedDelta = Math.max(-cap, Math.min(cap, delta));
			const progress = lastProgress + clampedDelta;
			lastProgress = progress;
			this.#stateMachine.setSettleState({ progress });
			// `done` requires BOTH the elapsed-time ease to reach u=1 AND
			// the clamped progress to reach the target. The clamp can lag
			// the elapsed-time curve, so the rAF reschedules until both
			// hold; the few extra ticks close the gap gracefully.
			const atTarget = Math.abs(this.#settleTargetProgress - progress) < 1e-6;
			if (u >= 1 && atTarget) {
				this.#settleRafId = undefined;
				// Commit settle: hold at target, wait for the nav-landed
				// clear. Cancel / non-gesture settle: end now (no nav
				// landing to wait for; the rAF reaching the target is the
				// end-of-animation signal).
				if (!this.#settleAwaitTitle) this.#endSettleEase();
				return;
			}
			this.#settleRafId = requestAnimationFrame(tick);
		};
		this.#settleRafId = requestAnimationFrame(tick);
	}

	/** Cancel the settle rAF (no endSettle). Used by `#armSettleEase`
	 *  (a fresh arm overwrites the settle state), `#endSettleEase`
	 *  (which clears it), and `unmount` (the mobile -> desktop flip
	 *  teardown). The route-swap teardown `releaseInputs` intentionally
	 *  does NOT cancel a commit settle awaiting its navigation landing;
	 *  `onSvelteKitBeforeNavigate` ends the settle when the nav leaves
	 *  the pipeline for a non-pipeline route (no landing will clear its
	 *  awaitTitle). */
	#cancelSettleEaseRaf(): void {
		if (this.#settleRafId !== undefined) {
			cancelAnimationFrame(this.#settleRafId);
			this.#settleRafId = undefined;
		}
	}

	/** End the active settle: drop `settleActive` and clear the latched
	 *  record. The publication's `settleProgress` is NOT reset here; it
	 *  stays at its last value (1 for commit, 0 for cancel). The no-snap
	 *  is structural: after landing, `currentHasTabs` and the live title
	 *  already match the latched incoming values, so the morph / titleView
	 *  rest branches (which return `currentHasTabs ? 1 : 0` and ignore
	 *  `settleProgress`) produce the same value the settle branch ended
	 *  at. */
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
	 *  The start progress is `this.#publication.progress` at release (the
	 *  orchestrator's live published raw, not the executor's
	 *  threshold-absorbed `state.progress`) so the morph is continuous
	 *  across the drag-to-settle boundary (no snap).
	 *  `committed` true → target 1 + awaitTitle; false → target 0, no
	 *  await.
	 *
	 *  The settle ease duration is the executor's velocity-matched commit
	 *  duration (`commitStart.durationMs`) so the Header morph / title
	 *  crossfade tracks the slide end-to-end. A fast release (~120ms) and
	 *  the Header settle finish together; a slow release (~600ms) and they
	 *  run together too. Both the commit and the cancel settle read the
	 *  same duration: the executor solves the cancel slide's duration too
	 *  (velocity-matched for a reversed release, COMMIT_T_DEFAULT_MS for a
	 *  drag-direction release), so the Header morph / title crossfade
	 *  tracks the cancel slide end-to-end as well. */
	#armSettleEaseFromGesture(committed: boolean): void {
		if (!browser) return;
		const inputs = this.#mountInputs;
		const pending = this.#pendingGesture;
		const executor = this.#executor;
		if (inputs === null || pending === null || executor === null) return;
		const back = pending.to;
		const t = this.#headerT;
		// outgoingTitle is the LIVE source title (`#prevHeaderTitle`, kept
		// current by `notifyHeaderState`), not `resolveDeepHeaderTitle`: the
		// dynamic-title routes (`/profile/<id>/<slug>`, `/category/<slug>`,
		// `/profile/discussions/<id>/<slug>`) carry their title in
		// `page.data.headerTitle`, which `resolveDeepHeaderTitle` does not
		// know (returns null). Using the resolver here would snap the
		// outgoing span to '' at the drag-to-settle boundary on those routes.
		const outgoingTitle = this.#prevHeaderTitle;
		const incomingTitle = t ? (resolveDeepHeaderTitle(back, t) ?? '') : '';
		const outgoingHasTabs = inputs.fromTabIndex >= 0;
		const incomingHasTabs = getCurrentTabIndex(back) >= 0;
		// Capture the drag branch's terminal morph (the value the Header was
		// rendering the instant before the settle took over) so the settle
		// interpolation starts where the drag ended (DV21 §5: no morph snap at
		// the release handoff). The drag morph depends on the gesture shape;
		// `#dragMorphAtSettleTakeover` mirrors the Header's drag branch
		// end-to-end (deep-to-deep hardcoding 0, `targetIsSearch` and
		// non-centerTab tab-to-tab holding at the source's at-rest, everything
		// else following the anchor-shifted natural(raw) curve). When a drag
		// took over an in-flight settle (re-grab, gesture-during-forward-
		// enter), `#dragMorphAnchor` holds the morph value that settle was
		// rendering at the takeover instant. The helper has TWO anchor-aware
		// paths so the new settle's `startMorph` equals the drag's actual
		// terminal value (no morph snap at the drag-to-settle handoff, DV21
		// §5): the `dragMorphWasStatic` shapes (`targetIsSearch`,
		// non-centerTab tab-to-tab) return `anchor.morph` directly (mirroring
		// the drag branch's `targetIsSearch` and null-`backMorph`
		// short-circuits), and the bm-following shapes apply the anchor shift
		// inside `#dragMorphAtAnchorOrRaw`. The shared helper is also called
		// from the discrete-nav arm so the two drag-to-settle capture sites
		// stay in sync.
		const raw = this.#publication.progress;
		const targetIsSearch = resolveHeaderMode(back) === 'search';
		const isDeepToDeep = !outgoingHasTabs && !incomingHasTabs;
		const isCenterTabRoute = inputs.centerTab !== undefined;
		const startMorph = this.#dragMorphAtSettleTakeover(
			outgoingHasTabs,
			incomingHasTabs,
			isCenterTabRoute,
			targetIsSearch,
			raw
		);
		// destMorph is the morph value the settle ends at. For most shapes
		// this is the incoming route's at-rest morph on a commit (going to
		// the destination), the outgoing route's at-rest morph on a cancel
		// (returning to the source). The `/search` destination is special:
		// at landing `isSearch` flips to true and the Header's `iconProgress`
		// and `rootLayerStyle` derivations override the morph-based branch
		// (`iconProgress = isSearch ? 0`, `rootLayerStyle = isSearch ?
		// 'transform: none'`), so the morph value at landing has no direct
		// visual effect BUT the pre-landing `morph` drives `rootLayerStyle`'s
		// `translateY` until the flip. Easing toward the `/search` at-rest
		// morph (0) during the settle would rotate the icon to back-arrow
		// then snap it back to hamburger at landing; easing toward the
		// SOURCE's at-rest morph (1 for a tab-root source) keeps the
		// `translateY` at 0% across the whole settle so the flip to
		// `transform: none` is continuous (R8-A F1: a re-grab whose
		// `anchor.morph` differs from the source's at-rest must ease
		// toward the source's at-rest, not hold at `anchor.morph`, or the
		// landing snaps). For the no-anchor from-rest case
		// `startMorph === atRestMorph(outgoing)`, so easing toward the
		// same value is a constant hold (the from-rest tab-root source
		// holds at 1 across the settle and the landing's flip to
		// `transform: none` is a no-op for the translateY).
		const destMorph = isDeepToDeep
			? 0
			: targetIsSearch
				? this.#atRestMorph(outgoingHasTabs)
				: this.#atRestMorph(committed ? incomingHasTabs : outgoingHasTabs);
		const latched: HeaderSettleTransition = {
			outgoingTitle,
			incomingTitle,
			outgoingHasTabs,
			incomingHasTabs,
			startMorph,
			destMorph
		};
		const startProgress = this.#publication.progress;
		const commitDurationMs = executor.state.commitStart?.durationMs ?? TITLE_CROSSFADE_MS;
		// Capture the FAB scale the drag was rendering the instant before
		// the settle takes over (DV21 §5 sibling-visual rule: the FAB tier
		// needs the same drag-terminal capture the morph tier just made via
		// `startMorph`). `#fabScaleAtSettleInstant` reads the live FAB layer
		// state through the shared `computeFabScale` function, so for shapes
		// where the FAB layer reads branch 4 (`dragAnchor !== null`) it
		// returns the dragAnchor-shifted value; for shapes where it reads
		// branch 5 (the natural formula) it returns that formula at the
		// release raw; either way the captured value equals the displayed
		// FAB at the release instant. Stashed BEFORE `#armSettleEase`
		// because the arm clears `#dragFabAnchor` at its top, dropping the
		// FAB layer to branch 5 (the natural formula), which disagrees with
		// the drag's terminal FAB value for asymmetric shapes
		// (from-only-FAB, to-only-FAB, boundary, suppressed, enterAnchor).
		// The post-arm re-seed below restores a lerp anchor so the FAB
		// layer's branch 3 interpolates from the captured drag-terminal
		// value to the destination's at-rest FAB scale across
		// `settleMorphFraction` (mirroring how the morph tier's settle
		// branch lerps `startMorph -> destMorph` across the same fraction).
		const capturedFabScale = this.#fabScaleAtSettleInstant();
		this.#armSettleEase(
			latched,
			startProgress,
			committed ? 1 : 0,
			committed, // awaitTitle only on a commit (cancel has no nav)
			// Derive from the gesture direction. Maps TransitionDirection
			// 'backward' to the settle enum 'back'; 'forward' to 'forward'.
			// Forward tab-to-tab has empty equal titles, so the crossfade
			// direction is invisible there.
			pending.direction === 'forward' ? 'forward' : 'back',
			commitDurationMs
		);
		// Re-seed `#enterFabAnchor` AFTER `#armSettleEase` so the anchor
		// clear at the top of the arm does not wipe the new value (mirrors
		// `playEnterAnimation`'s post-arm re-seed pattern, R8-A F4, and
		// `#accelerateInFlight`'s, R10-A F1). `dest` is the at-rest FAB
		// presence the FAB layer WILL read at this settle's end: branch 5
		// at `progress = 1` (commit) returns `toHasFab ? 1 : 0`; at
		// `progress = 0` (cancel) returns `fromHasFab ? 1 : 0`. The lerp
		// hits that value at `settleMorphFraction = 1`, so the
		// settle-to-at-rest handoff is continuous (no snap when
		// `settleActive` flips false and branch 5 takes over). For
		// symmetric shapes (`fromHasFab === toHasFab`) on a commit the
		// handoff dip (both have FAB) or the no-op hold (neither has FAB)
		// already made the drag-terminal equal to the natural formula at
		// the release raw, so the re-seed is a no-op for the visual but
		// still correct.
		if (capturedFabScale !== null) {
			const back = pending.to;
			const fromHasFab = getRouteData(inputs.fromPathname).fab;
			const toHasFab = getRouteData(back).fab;
			const destFabScale = committed ? (toHasFab ? 1 : 0) : fromHasFab ? 1 : 0;
			this.#enterFabAnchor = { start: capturedFabScale, dest: destFabScale };
		}
	}

	/** The drag's terminal morph at the moment a settle takes over,
	 *  classified by gesture shape to mirror the Header's drag branch
	 *  exactly. Used by both drag-to-settle capture sites
	 *  (`#armSettleEaseFromGesture` at gesture release and the
	 *  `onSvelteKitBeforeNavigate` discrete-nav arm at a tab-click /
	 *  `goto` / popstate interrupt) so both sites capture the same value
	 *  for the same shape (DV21 §5 "following-visual" at every
	 *  drag-to-settle handoff). The shape classification matches the
	 *  Header's drag branch end-to-end:
	 *   - `isDeepToDeep` (both endpoints have no tabs): the drag branch
	 *     hardcodes 0 regardless of `bm`, so the terminal morph is 0.
	 *   - `dragMorphWasStatic` shapes - `targetIsSearch` (destination
	 *     is `/search`) and non-centerTab tab-to-tab (NavPipelineTabHost
	 *     tab swipe, NavPipelineHost offline LIST routes whose
	 *     `leftHref` pill-maps to the same tab): the drag branch holds
	 *     the morph static at the source's at-rest. `targetIsSearch`
	 *     hits the `targetIsSearch` short-circuit; non-centerTab
	 *     tab-to-tab hits the null-`backMorph` fallback (because
	 *     `#republishToPager`'s non-centerTab `(fromIdx >= 0 && toIdx >=
	 *     0)` clause publishes `backMorph: null` end to end). When a
	 *     re-grab took over an in-flight settle in either shape (R8-A F1
	 *     / F2), the drag branch returns `anchor.morph` and so does
	 *     this helper; otherwise it returns
	 *     `atRestMorph(outgoingHasTabs)` (the from-rest case).
	 *   - everything else (centerTab thread -> tab-root, deep -> tab,
	 *     tab -> deep): the drag branch follows the anchor-shifted
	 *     natural(raw) curve via `#dragMorphAtAnchorOrRaw`.
	 *  Callers supply the live `raw` at the appropriate instant:
	 *  `#armSettleEaseFromGesture` reads `#publication.progress` at
	 *  release (the drag is ending); the discrete-nav arm reads it
	 *  BEFORE its `this.#progress = 0` reset (the drag is being
	 *  interrupted). */
	#dragMorphAtSettleTakeover(
		outgoingHasTabs: boolean,
		incomingHasTabs: boolean,
		isCenterTabRoute: boolean,
		targetIsSearch: boolean,
		raw: number
	): number {
		if (!outgoingHasTabs && !incomingHasTabs) return 0;
		const isTabToTab = outgoingHasTabs && incomingHasTabs;
		const dragMorphWasStatic = targetIsSearch || (isTabToTab && !isCenterTabRoute);
		if (dragMorphWasStatic) {
			// R8-A F1 / F2: when a re-grab took over a non-tab-to-tab
			// settle whose morph was in flight (e.g. a deep->tab settle
			// interrupted by a tab-to-tab re-grab, or a back-swipe whose
			// new gesture flips to a forward-swipe-to-`/search`), the
			// drag morph derivation returns `anchor.morph` (the prior
			// settle's in-flight value) for the drag's whole duration
			// (see the Header's `targetIsSearch` and `bm === null`
			// short-circuits). Without this anchor-aware capture the new
			// settle's `startMorph` would default to
			// `atRestMorph(outgoingHasTabs)` and the morph would snap
			// from `anchor.morph` to the at-rest in one rAF frame at the
			// drag-to-settle handoff. Honor the anchor when set; collapse
			// to the at-rest when no anchor is in flight (the from-rest
			// case the static branch was designed for).
			const anchor = this.#dragMorphAnchor;
			if (anchor !== null) return anchor.morph;
			return this.#atRestMorph(outgoingHasTabs);
		}
		return this.#dragMorphAtAnchorOrRaw(outgoingHasTabs, raw);
	}

	/** The drag's terminal morph at release, accounting for the
	 *  `#dragMorphAnchor` if it is set. When a drag took over an in-flight
	 *  settle (re-grab, gesture-during-forward-enter) the Header's drag
	 *  branch shifts the natural curve to pass through the anchor's captured
	 *  morph, so the drag's actual terminal value is the anchor-shifted
	 *  natural(raw), not the natural(raw) alone. Mirrors the Header's
	 *  `dragMorphAnchor` branch exactly so the new settle's `startMorph`
	 *  equals the drag's terminal morph (continuity at the drag-to-settle
	 *  handoff, DV21 §5). */
	#dragMorphAtAnchorOrRaw(currentHasTabs: boolean, raw: number): number {
		const natural = currentHasTabs ? 1 - raw : raw;
		const anchor = this.#dragMorphAnchor;
		if (anchor === null) return natural;
		const naturalAtAnchor = currentHasTabs ? 1 - anchor.raw : anchor.raw;
		return Math.max(0, Math.min(1, anchor.morph + natural - naturalAtAnchor));
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
	 *  watch in `notifyHeaderState`.
	 *
	 *  `nonSearchIconValue` is the icon-morph value at the scrub's
	 *  non-search endpoint (0 for a tab root, 1 for a deep page). Published
	 *  to the pager store as `scrubIconEndpoint` so the Header's
	 *  `iconProgress` derivation lerps the hamburger <-> back-arrow morph
	 *  continuously across the URL swap frame (`iconProgress = tapMorph *
	 *  scrubIconEndpoint`). The search endpoint contributes 0 (the
	 *  search-layer hamburger), so a tab<->search scrub passes 0 (the
	 *  icon stays a hamburger at both endpoints) and a deep<->search scrub
	 *  passes 1 (the icon eases between back-arrow and hamburger). */
	#armTapScrubEase(
		fromValue: number,
		toValue: number,
		source: string,
		targetTabs: boolean,
		nonSearchIconValue: number
	): void {
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
		pager.setScrubIconEndpoint(nonSearchIconValue);
		// Reduced-motion: snap to target with no rAF. The subsequent
		// `#finishTapScrubEase()` clears tapMorph to null in the same
		// flush, so no intermediate `toValue` write is needed here.
		if (this.#driver?.prefersReducedMotion() ?? false) {
			this.#finishTapScrubEase();
			return;
		}
		// Last tapMorph value published by the rAF. Seeded at the arm
		// value so the first tick's clamp is measured from the start.
		let lastValue = fromValue;
		const tick = (): void => {
			const now = this.#clock();
			if (this.#scrubStartTs === 0) this.#scrubStartTs = now;
			const u = Math.min((now - this.#scrubStartTs) / TITLE_CROSSFADE_MS, 1);
			const eased = commitEase(u);
			const desired = this.#scrubFromValue + (this.#scrubToValue - this.#scrubFromValue) * eased;
			// Per-tick clamp (see `settlePerTickCap` in nav-executor-logic):
			// same policy as the executor's commit rAF and the settle ease
			// rAF; caps the single-tick advance so a delayed first rAF
			// tick under main-thread load cannot pop the search-layout
			// scrub.
			const span = Math.abs(this.#scrubToValue - this.#scrubFromValue);
			const cap = settlePerTickCap(TITLE_CROSSFADE_MS, span);
			const delta = desired - lastValue;
			const clampedDelta = Math.max(-cap, Math.min(cap, delta));
			const value = lastValue + clampedDelta;
			lastValue = value;
			getMobilePagerStore().setTapMorph(value);
			const atTarget = Math.abs(this.#scrubToValue - value) < 1e-6;
			if (u >= 1 && atTarget) {
				this.#finishTapScrubEase();
				return;
			}
			this.#tapScrubRafId = requestAnimationFrame(tick);
		};
		this.#tapScrubRafId = requestAnimationFrame(tick);
	}

	/** Cancel the tap-scrub rAF (no clear). Used by `#armTapScrubEase`
	 *  (a fresh arm overwrites the scrub state), `#finishTapScrubEase`
	 *  (which clears it), and `unmount` (the mobile -> desktop flip
	 *  teardown). The route-swap teardown `releaseInputs` intentionally
	 *  does NOT cancel a scrub awaiting its navigation landing, mirroring
	 *  the settle; `onSvelteKitBeforeNavigate` ends it when the nav
	 *  leaves the pipeline. */
	#cancelTapScrubRaf(): void {
		if (this.#tapScrubRafId !== undefined) {
			cancelAnimationFrame(this.#tapScrubRafId);
			this.#tapScrubRafId = undefined;
		}
	}

	/** Finish the tap-scrub ease: drop searchScrubbing and clear tapMorph
	 *  and scrubIconEndpoint so the morph / trackMorph / iconProgress
	 *  derivations fall through to the rest branch (the destination
	 *  route's at-rest value). Idempotent. */
	#finishTapScrubEase(): void {
		this.#cancelTapScrubRaf();
		this.#scrubSource = '';
		this.#scrubTargetTabs = false;
		this.#stateMachine.setSearchScrubbing(false);
		const pager = getMobilePagerStore();
		pager.setTapMorph(null);
		pager.setScrubIconEndpoint(null);
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
		// The latched record's endpoints survive the acceleration (the
		// source and destination do not change), but its `startMorph` must
		// shift to the morph value the settle is currently producing so the
		// accelerated interpolation starts where the in-flight one ended
		// (DV21 §5: no morph snap at the re-arm). The FAB tier mirrors the
		// same pattern via `#enterFabAnchor`: capture the in-flight FAB
		// value BEFORE `#armSettleEase` clears the anchor, then re-seed the
		// anchor AFTER the arm so the FAB scale derivation continues from
		// the visual it was rendering at the accelerate instant (DV21 §5:
		// no FAB snap at the re-arm). The capture reads the live anchor
		// state through `#fabScaleAtSettleInstant`; the commit slide is
		// in flight at the accelerate instant, so `pub.inFlight === true`
		// and the capture is non-null (the `!pub.inFlight` short-circuit
		// in `#fabScaleAtSettleInstant` does not fire here). For an enter
		// settle the captured value equals the displayed enterAnchor
		// lerp. The re-seed's `dest` carries over the prior anchor's
		// `dest` (the destination's resting FAB presence, which does not
		// change because the accelerate preserves endpoints). For an
		// anchor-set settle being accelerated (gesture-release, discrete-
		// nav, mid-settle absorb, R12-B F1 siblings that set
		// `#enterFabAnchor`) the FAB layer reads branch 3, so the re-seed
		// fires whenever `prevEnterFabAnchor !== null` and the capture
		// mirrors branch 3 (single source of truth); the re-seed is
		// skipped when the in-flight settle was armed by a path that left
		// `#enterFabAnchor` null at the arm (from-rest discrete-nav or
		// fresh-enter), in which case the FAB layer reads branch 5 (the
		// natural `fabScale(progress, ...)` formula) end-to-end and no
		// snap is introduced.
		if (this.#stateMachine.settleActive && this.#stateMachine.settleLatched !== null) {
			const prevLatched = this.#stateMachine.settleLatched;
			const prevEnterFabAnchor = this.#enterFabAnchor;
			const capturedFabScale = this.#fabScaleAtSettleInstant();
			const latched: HeaderSettleTransition = {
				outgoingTitle: prevLatched.outgoingTitle,
				incomingTitle: prevLatched.incomingTitle,
				outgoingHasTabs: prevLatched.outgoingHasTabs,
				incomingHasTabs: prevLatched.incomingHasTabs,
				startMorph: this.#morphAtSettleInstant(prevLatched),
				destMorph: prevLatched.destMorph
			};
			this.#armSettleEase(
				latched,
				this.#stateMachine.settleProgress,
				this.#settleTargetProgress,
				this.#settleAwaitTitle,
				this.#stateMachine.settleDirection,
				acceleratedMs
			);
			// Re-seed AFTER `#armSettleEase` so the anchor clear at the
			// top of the arm does not wipe the new value (mirrors
			// `playEnterAnimation`'s post-arm re-seed pattern).
			if (prevEnterFabAnchor !== null && capturedFabScale !== null) {
				this.#enterFabAnchor = {
					start: capturedFabScale,
					dest: prevEnterFabAnchor.dest
				};
			}
		}
	}

	/** Centralized interruption: cancel every running animation ease
	 *  (settle + tap-scrub) so a new gesture or a fresh discrete nav owns
	 *  the morph from the current visual position with no competing rAF
	 *  underneath. Called from `#beginGesture` on every re-grab (from-rest
	 *  or mid-transition) AND from the `onSvelteKitBeforeNavigate`
	 *  discrete-nav path (a tab-click or deep-to-deep nav arriving outside
	 *  the `phase === 'committing'` finish-then-new branch). This is ONE
	 *  of several settle-cancellation sites, not the sole point: the
	 *  settle ease is also ended by `#onExecutorSettle`'s
	 *  `#endSettleEase` for a non-pipeline commit target, the
	 *  `onSvelteKitBeforeNavigate` supersede branch's `#endSettleEase`
	 *  when an external nav supersedes the in-flight goto,
	 *  `onSvelteKitAfterNavigate`'s `#endSettleEase` on a nav-landed
	 *  awaitTitle clear, the settle rAF tick's `#endSettleEase` when u
	 *  reaches 1 on a non-await settle, `notifyHeaderState`'s
	 *  `#endSettleEase` on an awaitTitle clear or a mid-settle revert,
	 *  and `unmount`'s `setSettleState({ active: false })` teardown.
	 *  (`#armSettleEase` cancels the previous settle's rAF via
	 *  `#cancelSettleEaseRaf` on a rapid back-to-back re-arm, but the
	 *  settle is re-armed, not ended; the reduced-motion non-await path
	 *  does call `#endSettleEase`. `notifyHeaderState` also finishes an
	 *  in-flight tap-scrub when it sees `pager.dragging`.) */
	#cancelAllAnimationEases(): void {
		this.#endSettleEase();
		this.#finishTapScrubEase();
	}

	// -----------------------------------------------------------------------
	// Header-state detection (settle + tap-scrub arm triggers).

	/** Reset the cached header-state fields so the next `notifyHeaderState`
	 *  call re-initializes from its current arguments instead of
	 *  crossfading from stale prev values. Called from the Header
	 *  component's `onMount`, which fires whenever a fresh Header instance
	 *  mounts (initial app load and the AppShell unmount / remount across
	 *  a `/entry/*` detour such as login or logout). The Header persists
	 *  across pipeline route swaps (same instance, only its reactive
	 *  inputs change), so this does NOT fire on a route swap and the
	 *  cached prev values survive a normal swap. Without this reset the
	 *  orchestrator's `#headerStateInitialized` stays `true` across the
	 *  AppShell unmount, and the first `notifyHeaderState` on the
	 *  remounted Header arms a settle against the prev values captured
	 *  before the detour (visible as a ~200ms glitch: stale title and a
	 *  back-arrow on the home tab root). */
	resetHeaderState(): void {
		this.#headerStateInitialized = false;
		this.#prevHeaderTitle = '';
		this.#prevHeaderHasTabs = false;
		this.#prevHeaderIsSearch = false;
	}

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
		// Always update the translation dict before the `!#mounted` guard
		// below so the gesture-release settle arming (which reads
		// `#headerT` via `resolveDeepHeaderTitle` in
		// `#armSettleEaseFromGesture`) sees the current dict even after a
		// gap-frame call (releaseInputs -> the next configure) that hit the
		// guard and early-returned.
		this.#headerT = t;
		// Header persists in AppShell; on a mobile -> desktop flip the
		// orchestrator's `unmount` tears down the host inputs and clears
		// `#mounted`. The Header's `$effect.pre` keeps firing on
		// navigations, but with no host mounted the orchestrator must not
		// re-arm eases (the settle / tap-scrub rAFs would tick against
		// torn-down state). No-op until the next `configure`.
		//
		// A call with no host mounted is either the gap frame of a direct
		// pipeline -> pipeline handoff (releaseInputs -> configure) or a
		// non-pipeline detour (the user left the pipeline for a route with
		// no pipeline host, and the persistent Header is now showing that
		// route's title). In the gap-frame case a commit / discrete settle
		// is in flight awaiting the destination's landing, and the prev
		// values MUST stay frozen so the destination's first notify call
		// crossfades from the genuine outgoing title. In the detour case
		// the settle is no longer in flight: `onSvelteKitBeforeNavigate`
		// ends the animation eases when the nav leaves the pipeline, so
		// the prev values refresh to what the Header is actually
		// displaying; otherwise a later return to a pipeline route would
		// crossfade from the stale pre-detour title.
		if (!this.#mounted) {
			if (!this.#stateMachine.settleActive) {
				this.#prevHeaderTitle = newTitle;
				this.#prevHeaderHasTabs = currentHasTabs;
				this.#prevHeaderIsSearch = currentIsSearch;
			}
			return;
		}
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
				pager.dragging ||
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
			// on a stale title. When the new title equals the OUTGOING
			// title the route reverted to the source, so the settle ends
			// (the else branch below) instead of re-arming; only a
			// genuinely third title re-arms.
			// The settle rAF's startProgress is the CURRENT settleProgress,
			// so the title crossfade continues from the in-flight position:
			// the outgoing title span keeps its mid-settle offset and the
			// new incoming title enters from below. The re-arm passes
			// `#settleTargetProgress` so the in-flight settle's direction
			// survives the re-arm: a cancel settle (target 0) interrupted
			// by a live-title resolution stays a cancel, and a commit
			// settle (target 1) stays a commit. The new latched's
			// `startMorph` is the morph VALUE at the re-arm instant
			// (interpolated from the prior latched's startMorph / destMorph
			// at the current `settleMorphFraction`), so the morph continues
			// from the in-flight position rather than re-evaluating against
			// the new endpoints (DV21 §5: no morph snap at the re-arm).
			if (newTitle !== this.#resolveSettleOutgoingTitle()) {
				const prevLatched = this.#readSettleLatched();
				if (prevLatched !== null) {
					const newOutgoingHasTabs = prevLatched.incomingHasTabs;
					const newIncomingHasTabs = currentHasTabs;
					const startMorph = this.#morphAtSettleInstant(prevLatched);
					const destMorph = this.#atRestMorph(
						this.#settleTargetProgress === 1 ? newIncomingHasTabs : newOutgoingHasTabs
					);
					const latched: HeaderSettleTransition = {
						outgoingTitle: prevLatched.incomingTitle,
						incomingTitle: newTitle,
						outgoingHasTabs: newOutgoingHasTabs,
						incomingHasTabs: newIncomingHasTabs,
						startMorph,
						destMorph
					};
					// Capture the FAB scale the in-flight settle was
					// rendering at the re-arm BEFORE `#armSettleEase`
					// clears `#enterFabAnchor` (DV21 §5 sibling-visual
					// rule: the FAB tier needs the same in-flight
					// capture the morph tier made above as `startMorph`).
					// For an anchor-set non-enter settle being re-armed
					// (gesture-release, discrete-nav,
					// accelerate-in-flight) the FAB layer reads branch 3
					// (enterAnchor lerp via `computeFabScale`), not
					// branch 5; the capture via
					// `#fabScaleAtSettleInstant` mirrors branch 3
					// (single source of truth), and the re-seed is
					// required for boundary continuity for the same
					// reason as the enter-settle case below. The only
					// no-op case is the idle title-change arm (from-rest
					// same-tab-ness navs): `#enterFabAnchor` is null at
					// the capture, so the null-guard skips the re-seed
					// and the FAB layer reads branch 5 end-to-end.
					// For an enter settle being re-armed (a different
					// title arriving mid-enter on a dynamic-title route)
					// the capture mirrors the enterAnchor lerp value the
					// FAB layer was rendering; without this re-seed the
					// post-arm branch 5 (natural formula) would snap from
					// that lerp value to the natural formula at the
					// current `settleProgress` for asymmetric FAB shapes
					// (R12-B F1 sibling defect at the mid-settle re-arm).
					const capturedFabScale = this.#fabScaleAtSettleInstant();
					const prevSettleTargetProgress = this.#settleTargetProgress;
					this.#armSettleEase(
						latched,
						this.#stateMachine.settleProgress,
						prevSettleTargetProgress,
						false,
						this.#resolveNavDirection()
					);
					// Re-seed `#enterFabAnchor` AFTER the arm so the FAB
					// layer's branch 3 lerps from the captured in-flight
					// value to the new endpoint's at-rest FAB scale across
					// `settleMorphFraction`. `dest` mirrors the morph
					// tier's `destMorph` resolution: on a commit
					// (`settleTargetProgress === 1`) the destination is
					// the new incoming route; on a cancel (target 0) it
					// is the new outgoing route. Branch 5 at those
					// progress values returns the at-rest FAB presence
					// for the matching endpoint, so the lerp's dest
					// matches the post-settle value (no snap when
					// `settleActive` flips false).
					if (capturedFabScale !== null) {
						const pub = this.#publication;
						const fromPathname = pub.fromPathname ?? '';
						const toPathname = pub.toPathname ?? '';
						const destPathname = prevSettleTargetProgress === 1 ? toPathname : fromPathname;
						const destHasFab = getRouteData(destPathname).fab;
						this.#enterFabAnchor = { start: capturedFabScale, dest: destHasFab ? 1 : 0 };
					}
				}
			} else if (!this.#settleAwaitTitle) {
				// The settle was an idle title change (not awaiting a nav
				// landing) and the route reverted to the outgoing title:
				// the transition is undone. End the settle so the at-rest
				// branch takes over with the live route's title / tab-ness
				// instead of running the rAF toward the stale incoming
				// endpoint. A commit settle (`awaitTitle` true) does NOT
				// end here: its live title is the outgoing because the nav
				// has not landed yet, not because it reverted, so the
				// settle must keep running.
				this.#endSettleEase();
			}
			this.#prevHeaderTitle = newTitle;
			this.#prevHeaderHasTabs = currentHasTabs;
			this.#prevHeaderIsSearch = currentIsSearch;
			return;
		}
		// tap-scrub arm: a navigation that flipped `isSearch` (one side
		// is /search), did not land via the orchestrator's own commit
		// dispatch, and has no pipeline slide in flight
		// (`pager.transitionTarget === null`). Covers root<->search (the
		// search-button tap), deep<->search (/profile <-> /search,
		// /messages/<id> <-> /search, /search <-> /bookmarks, etc.). A
		// forward nav whose destination runs `playEnterAnimation` (which
		// sets `transitionTarget` synchronously in `onMount`) skips the
		// scrub; the enter slide's `backMorph` drives the morph instead
		// (spec Step 5 sanctions the `transitionTarget` arbitration). The
		// orchestrator owns this motion on its rAF (§5: no CSS
		// transitions in this layer); the Header's horizontal-track /
		// search-button / scope-tab-bar readers follow `pager.tapMorph`
		// while the scrub runs.
		//
		// The scrub values are `isSearch`-based (1 = not search, 0 =
		// search). This represents the search-layout position the Header
		// consumes (searchProgress = 1 - tapMorph) and drives both the
		// root<->search and the deep<->search trajectories; the hasTabs
		// signal cannot drive the latter (it is false at /profile and
		// /search).
		//
		// The icon-morph endpoint (`nonSearchIconValue`) is the icon
		// value at the non-search side of the scrub: 0 when that side is
		// a tab root (icon = hamburger at both endpoints, so the morph
		// holds at hamburger throughout), 1 when it is a deep page (icon
		// = back-arrow at the deep endpoint, hamburger at /search, so the
		// morph eases between them across the scrub). The non-search
		// endpoint is the previous route when the URL just landed on
		// /search (`prevIsSearch === false`) and the current route when
		// the URL just left /search (`prevIsSearch === true`).
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
			// The non-search endpoint's hasTabs: when the URL just landed
			// on /search the non-search side is the previous route (read
			// `#prevHeaderHasTabs`, captured before this call updates it);
			// when the URL just left /search the non-search side is the
			// current route (`currentHasTabs`).
			const nonSearchHasTabs = prevIsSearch ? currentHasTabs : this.#prevHeaderHasTabs;
			const nonSearchIconValue = nonSearchHasTabs ? 0 : 1;
			this.#armTapScrubEase(fromValue, toValue, newPath, currentHasTabs, nonSearchIconValue);
		}
		// Idle: arm the crossfade ONLY on a title change. By the time
		// control reaches here, every nav the discrete-nav branch
		// intercepts that visibly changes the morph (the tab-ness-changing
		// navs deep<->tab and `/search` <-> tab-root, AND the same-tab-ness
		// navs whose live drag had advanced the morph away from rest) was
		// armed CONCURRENTLY with the slide there; on landing the
		// mid-settle absorb branch above picks those up. The cases that
		// fall through to this idle arm are the from-rest same-tab-ness
		// navs (deep->deep forward / popstate and tab->tab clicks on the
		// bidirectional host with no live drag in flight), where the
		// morph holds at the source's at-rest value end to end (both
		// endpoints share the same `currentHasTabs`), so the only visual
		// that may need animation is the title crossfade (deep->deep); a
		// tab->tab click has the same title and arms nothing. The icon's
		// freeze across a `/search` <-> tab-root slide (which DOES arm
		// via the discrete-nav branch, morph running 0 <-> 1 across the
		// slide) is owned by the `isSearch || (searchScrubbing &&
		// currentHasTabs)` clause in the Header's `iconProgress`: at
		// the /search end `isSearch` keeps `iconProgress = 0`
		// (hamburger) regardless of the morph value, so the morph
		// animating underneath does not flash the back-arrow; the
		// tap-scrub arm above owns the root<->search horizontal-track
		// scrub on its own rAF for the no-slide search-button case.
		if (newTitle !== this.#prevHeaderTitle) {
			// No preceding gesture owns the morph at an idle title-change
			// arm (the navigation already landed; this arm crossfades the
			// title only). `startMorph` is the source route's at-rest morph
			// and `destMorph` is the destination route's at-rest morph; this
			// arm only fires for from-rest same-tab-ness navs (the live-drag
			// and tab-ness-change shapes armed earlier in the discrete-nav
			// branch), so the two at-rests are numerically equal and the
			// morph holds at that value across the whole settle while the
			// title crossfade plays.
			const startMorph = this.#atRestMorph(this.#prevHeaderHasTabs);
			const destMorph = this.#atRestMorph(currentHasTabs);
			const latched: HeaderSettleTransition = {
				outgoingTitle: this.#prevHeaderTitle,
				incomingTitle: newTitle,
				outgoingHasTabs: this.#prevHeaderHasTabs,
				incomingHasTabs: currentHasTabs,
				startMorph,
				destMorph
			};
			this.#armSettleEase(latched, 0, 1, false, this.#resolveNavDirection());
		}
		this.#prevHeaderTitle = newTitle;
		this.#prevHeaderHasTabs = currentHasTabs;
		this.#prevHeaderIsSearch = currentIsSearch;
	}

	/** Compute the morph value the in-flight settle is currently producing
	 *  from its latched startMorph / destMorph pair and the current
	 *  `settleMorphFraction`. Used by the mid-settle absorb re-arm in
	 *  `notifyHeaderState` and `#accelerateInFlight` so the new settle's
	 *  `startMorph` continues from the in-flight morph value rather than
	 *  re-evaluating against the new endpoints (no snap at the re-arm). */
	#morphAtSettleInstant(latched: HeaderSettleTransition): number {
		const frac = this.#settleMorphFraction();
		return latched.startMorph + (latched.destMorph - latched.startMorph) * frac;
	}
	/** The FAB scale the in-flight settle (or live drag) was rendering at
	 *  the takeover instant, computed via the SAME `computeFabScale`
	 *  function the FAB layer reads (single source of truth - DV21 §5:
	 *  every visual is a pure function of the one published progress,
	 *  continuous at every gesture boundary). Used by six capture sites
	 *  so each new settle's `#enterFabAnchor.start` (or the
	 *  `#dragFabAnchor.scale`) mirrors the displayed FAB at the takeover
	 *  instant:
	 *   - `#beginGesture` captures `#dragFabAnchor` for the FAB layer's
	 *     shift-formula continuity across a re-grab (R8-A F3).
	 *   - `#onExecutorSettle` stashes `#priorTerminalFabScale` for
	 *     `playEnterAnimation`'s commit-to-enter handoff (R8-A F4).
	 *   - `#accelerateInFlight` captures the in-flight FAB value to
	 *     re-seed `#enterFabAnchor` when accelerating an in-flight settle
	 *     (R10-A F1).
	 *   - `#armSettleEaseFromGesture` captures the drag-terminal FAB
	 *     value to seed `#enterFabAnchor` for the release settle, so the
	 *     FAB layer's branch 3 lerps from the drag's terminal FAB value
	 *     to the destination's at-rest FAB scale across
	 *     `settleMorphFraction` (R12-B F1).
	 *   - The `onSvelteKitBeforeNavigate` discrete-nav arm captures the
	 *     drag-terminal FAB value BEFORE the state-machine dispatch and
	 *     `#progress = 0` reset (co-located with the `liveDragMorph`
	 *     capture) to seed `#enterFabAnchor` at a tab-click / `goto` /
	 *     popstate interrupt. The capture reads the drag's live raw on
	 *     the drag's plan scale and endpoints (R14 F1). The re-seed
	 *     runs AFTER `#armSettleEase` so the FAB layer's branch 3 lerps
	 *     from the captured dragAnchor-shifted (or natural-formula)
	 *     value to the destination's at-rest FAB scale across
	 *     `settleMorphFraction` (R12-B F1 sibling).
	 *   - The `notifyHeaderState` mid-settle absorb captures the in-flight
	 *     FAB value to seed `#enterFabAnchor` when a dynamic-title route
	 *     resolves a new title mid-enter, so the FAB layer's branch 3
	 *     lerps from the captured in-flight value to the new endpoint's
	 *     at-rest FAB scale across `settleMorphFraction` (R12-B F1
	 *     sibling).
	 *  Returns null only when the publication is not in-flight or has no
	 *  resolved FROM/TO; both are guaranteed while a settle or drag is
	 *  active. */
	#fabScaleAtSettleInstant(): number | null {
		const pub = this.#publication;
		if (!pub.inFlight || pub.fromPathname === null || pub.toPathname === null) return null;
		const fromPathname = pub.fromPathname;
		const toPathname = pub.toPathname;
		const fromHasFab = getRouteData(fromPathname).fab;
		const toHasFab = getRouteData(toPathname).fab;
		return computeFabScale({
			progress: pub.progress,
			fromHasFab,
			toHasFab,
			isBoundary: fromPathname === toPathname,
			isSuppressedTab: pub.plan?.pageTrack.distance === 0 && getRouteData(toPathname).tag === 'tab',
			settleActive: pub.settleActive,
			settleMorphFraction: pub.settleMorphFraction,
			enterAnchor: this.#enterFabAnchor,
			dragAnchor: this.#dragFabAnchor
		});
	}

	/** The Header's `searchProgress` value at the current publication instant,
	 *  mirroring the derivation in `Header.svelte` so capture sites can stash
	 *  the in-flight search-axis position at a boundary (the discrete-nav
	 *  interrupt for R23-B F1, the commit slide end for R23-B F2). Returns
	 *  null when no transition is in flight (mirroring `#fabScaleAtSettleInstant`'s
	 *  `!pub.inFlight` short-circuit), so the discrete-nav re-seed's
	 *  `if (capturedSearchProgress !== null)` guard skips for a from-rest
	 *  tab-click and the Header's natural `searchProgress` derivation handles
	 *  the settle.
	 *
	 *  Reads `inputs.fromPathname` (the Header's `currentPath`), the
	 *  publication's `toPathname` (what `#republishToPager` writes to
	 *  `pager.transitionTarget`), and `progress` (what `#republishToPager`
	 *  writes to `pager.backMorph`). Does NOT read the tap-scrub branch
	 *  (`pager.tapMorph`): the capture sites fire during a drag / commit /
	 *  enter settle, never during a tap-scrub, so the tapMorph branch is
	 *  unreachable here. */
	#searchProgressAtSettleInstant(): number | null {
		const inputs = this.#mountInputs;
		if (inputs === null) return null;
		const pub = this.#publication;
		if (!pub.inFlight || pub.toPathname === null) return null;
		const currentPath = inputs.fromPathname;
		const isSearch = resolveHeaderMode(currentPath) === 'search';
		const targetIsSearch = resolveHeaderMode(pub.toPathname) === 'search';
		const trackMorph = pub.toPathname === currentPath ? 1 - pub.progress : pub.progress;
		return isSearch ? 1 - trackMorph : targetIsSearch ? trackMorph : 0;
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
			// Thread route: the pill stays on centerTab at rest, active:
			// true so the live fractionalIndex is published, backMorph:
			// null so the Header stays in root mode end to end (tab bar
			// visible, hamburger icon) for the thread route.
			pager.set({
				fractionalIndex: centerTab,
				dragging: false,
				active: true,
				backMorph: null,
				targetIndex: null,
				transitionTarget: null
			});
		} else if (inputs?.bidirectional === true) {
			const fromIdx = inputs?.fromTabIndex ?? -1;
			// Tab host at rest (NavPipelineTabHost): the active tab is the
			// pill's resting index, active: true so the live fractionalIndex
			// is published, backMorph: null so the Header stays in hamburger
			// mode (tab-to-tab transitions never morph toward the
			// back-arrow).
			pager.set({
				fractionalIndex: fromIdx,
				dragging: false,
				active: true,
				backMorph: null,
				targetIndex: null,
				transitionTarget: null
			});
		} else {
			const fromIdx = inputs?.fromTabIndex ?? -1;
			// NavPipelineHost at rest (no centerTab, not bidirectional). Two
			// sub-cases share this branch:
			//  - True deep pages (`/profile/*`, `/bookmarks`, `/search`,
			//    `/discussion/*` outside the centerTab shape, etc.) have
			//    `fromTabIndex === -1` (no pill mapping); the Header reads
			//    `currentHasTabs === false` and the morph derivation's
			//    at-rest branch returns 0 (back-arrow mode). The
			//    MobileTabBar reads the URL-derived pill index
			//    (`getCurrentTabIndex(currentPath)`) when `pager.active
			//    === false`, which is also -1 here, so no pill is
			//    highlighted.
			//  - Offline LIST mirrors (`/offline`, `/offline/activity`,
			//    `/offline/bookmarks`) pill-map to a tab via
			//    `getCurrentTabIndex` (the `TAB_BAR_CONFIG` patterns map
			//    `/offline` -> discussions, etc.), so `fromTabIndex >= 0`
			//    and the URL-derived pill index selects the offline route's
			//    tab. The Header reads `currentHasTabs === true` and the
			//    morph derivation's at-rest branch returns 1 (hamburger
			//    mode), so the published `backMorph: 0` is not read at
			//    rest (the at-rest branch ignores `backMorph`); the value
			//    only seeds drag-time consumers if a drag begins before
			//    the first `#republishToPager` write.
			// `active: false` so the pager reports no live drag; `backMorph:
			// 0` so any drag-time reader that samples before the first
			// `#republishToPager` write sees a deep-mode seed (the first
			// pointermove overwrites it with the live raw drag fraction).
			pager.set({
				fractionalIndex: fromIdx,
				dragging: false,
				active: false,
				backMorph: 0,
				targetIndex: null,
				transitionTarget: null
			});
		}
	}

	/** Refresh the from-pathname (and from-tag) after a same-host route
	 *  change (e.g. /messages/123 -> /messages/456 on a thread host, or a
	 *  tab swap on the pipeline tab host) that reuses this host without remounting,
	 *  so a subsequent tab-exit is still owned (#isPipelineFrom matches the
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
		if (
			this.#pendingGesture !== null ||
			this.#pendingDiscreteNav !== null ||
			this.#isEnterAnimation
		)
			return;
		const toData = getRouteData(backTarget);
		this.#mountInputs = {
			...inputs,
			backTarget,
			toTag: toData.tag,
			toTabIndex: this.#tabIndexFor(backTarget)
		};
	}

	/** Internal: refresh the orchestrator's progress (synchronous per
	 *  pointermove during a drag; via the executor's rAF during a
	 *  commit/cancel slide) and re-publish to the pager store. Called
	 *  from two paths, both passing a RAW drag
	 *  fraction on the same scale: (1) the live-drag path
	 *  (`#interpretIntent`) passes `offsetX / W` directly; (2) the
	 *  commit path (`#onExecutorTick`) lerps from `#commitStartRaw`
	 *  toward the target raw along the executor's eased fraction. Both
	 *  values drive `backMorph` / `fractionalIndex` via
	 *  `#republishToPager` (and the FAB reads the raw via
	 *  `publication.progress` directly). The macro fields (plan, FROM/TO,
	 *  direction, in-flight) stay owned by the state machine; only the
	 *  per-frame `#progress` mutates here. The host's `$effect` only
	 *  handles the at-rest reset (when `publication.plan` becomes null);
	 *  the in-flight pager publication is the orchestrator's
	 *  responsibility.
	 *
	 *  The raw is clamped to [0, 1] at this site so an extrapolated
	 *  seed (a reverse-direction interrupt whose visual-derived
	 *  `startProgress` falls outside the new plan's travelled span - see
	 *  `progressAtTranslateX`'s extrapolation comment) cannot push
	 *  `publication.progress` / `pager.backMorph` outside the bounded
	 *  slide range. The track translate is unaffected: `trackTranslateX`
	 *  is linear and well-defined for any progress, so it carries the
	 *  out-of-range value transiently while the publication stays
	 *  bounded. Downstream consumers (FAB scale via `computeFabScale`,
	 *  Header morph via `BurgerArrowIcon`) self-clamp their outputs too, so the
	 *  clamp here is the central contract that lets those consumers
	 *  assume a bounded input. */
	#publish(rawDragFraction: number): void {
		if (this.#publication.plan === null) return;
		const raw = rawDragFraction < 0 ? 0 : rawDragFraction > 1 ? 1 : rawDragFraction;
		this.#progress = raw;
		this.#republishToPager(raw);
	}

	/** Republish the current publication to the pager store. Three modes:
	 *
	 *  Thread mode (centerTab set): publishes `backMorph: rawDragFraction`
	 *  so the Header's morph / layer derivation tracks the live drag on a
	 *  centerTab route the same way it tracks a non-centerTab deep route.
	 *  The morph derivation in the Header (`currentHasTabs ? 1 - bm : bm`)
	 *  eases morph from 1 (root / hamburger) toward 0 (deep / back-arrow)
	 *  as the swipe advances, giving the user gesture feedback that the
	 *  back-swipe is engaged. centerTab routes pill-map to a tab index
	 *  (`getCurrentTabIndex >= 0`) so `resolveHeaderMode` returns 'root'
	 *  and the tab bar stays visible at rest; the drag-time morph is the
	 *  gesture-feedback signal, not the destination state, and the
	 *  settle ease armed at release returns morph to the destination's
	 *  tab-ness (1 for a tab-root target, 0 for a deep target). The
	 *  tab-bar pill interpolates from `centerTab` toward the gesture's
	 *  target tab (a tab-click exit to a different tab) so the highlight
	 *  tracks the slide; for a same-tab back-swipe the target equals
	 *  `centerTab` so the pill holds. `targetIndex` stays null (the pill
	 *  uses the fractionalIndex path, not the deep-swipe path). The FAB
	 *  layer reads the orchestrator's publication directly (the raw slide
	 *  fraction via `progress` + FROM/TO FAB presence) for its scale,
	 *  NOT these pager fields.
	 *
	 *  Tab-host mode (no centerTab, bidirectional): interpolates
	 *  `fractionalIndex` between `fromTabIndex` and `toTabIndex`
	 *  (threshold-absorbed by `PILL_EXPANSION_THRESHOLD`) so the pill
	 *  follows the slide. Three sub-cases by destination:
	 *    - Tab-to-tab (target is a tab root): publishes `backMorph: null`
	 *      so the Header stays in hamburger mode end to end.
	 *    - Backward-to-deep-page (target is a deep page reached via
	 *      `previousEntryPathname`): the pill HOLDS at `fromTabIndex`
	 *      (the spatial-previous tab the resolver assumed is NOT where
	 *      the user is going), and publishes `backMorph: rawDragFraction`
	 *      so the Header morph reveals the back-arrow during the slide
	 *      (the destination is a deep page, matching NavPipelineHost's
	 *      backward behaviour). On landing the deep page's `configure`
	 *      publishes its own pill (`centerTab` for a thread, -1 for a
	 *      deep page).
	 *    - Forward-last-tab-to-`/search` (target is `/search`, reached via
	 *      `#nextTabTarget` when the active tab is the last tab on the
	 *      bidirectional host): the pill HOLDS at `fromTabIndex` (the
	 *      resolved `toTabIndex` is -1 because `/search` is not a tab),
	 *      and publishes `backMorph: rawDragFraction`. The Header's
	 *      `targetIsSearch` skip in its `morph` $derived ignores this
	 *      value for the vertical layer group; the `searchProgress` /
	 *      `trackMorph` derivation consumes it to drive the root<->search
	 *      horizontal scrub during the drag.
	 *
	 *  Deep-page mode (no centerTab, not bidirectional): same pill
	 *  interpolation, plus a `backMorph` publication that splits by
	 *  pill-mapping:
	 *    - True deep page (`fromTabIndex === -1`, e.g. `/profile/*`,
	 *      `/bookmarks`, `/search`, `/discussion/*` outside the centerTab
	 *      shape): publishes `backMorph: rawDragFraction` so the Header
	 *      morph tracks the finger.
	 *    - Offline LIST mirror whose target is also pill-mapped
	 *      (`fromTabIndex >= 0 && toIdx >= 0`, e.g. `/offline` -> `/`):
	 *      publishes `backMorph: null` (the `(fromIdx >= 0 && toIdx >= 0)`
	 *      clause in `backMorphValue` below). Both endpoints pill-map to
	 *      a tab via `TAB_BAR_CONFIG`, so the drag is tab-to-tab on a
	 *      non-bidirectional host and the Header stays in hamburger mode
	 *      end to end.
	 *
	 *  `transitionTarget` carries the in-flight destination so the
	 *  Header's morph derivation can resolve the back-arrow reveal. The
	 *  FAB layer does NOT read these pager fields; it reads the
	 *  orchestrator's publication directly. */
	#republishToPager(rawDragFraction: number): void {
		const pager = getMobilePagerStore();
		const publication = this.#publication;
		const plan = publication.plan;
		if (plan === null) {
			return;
		}
		const inputs = this.#mountInputs;
		const centerTab = inputs?.centerTab;
		if (centerTab !== undefined) {
			// The pill interpolates from centerTab toward the gesture's
			// target tab so a tab-click exit to a different tab tracks the
			// slide (a same-tab back-swipe targets centerTab, so the pill
			// holds). backMorph is the raw slide fraction so the Header's
			// morph / layer derivation tracks the live drag (gesture
			// feedback: the morph eases toward the back-arrow as the swipe
			// advances, then returns to the destination's tab-ness via the
			// settle ease at release). targetIndex stays null so the pill
			// uses the fractionalIndex path.
			const toIdx = this.#gestureToTabIndex ?? -1;
			const pillProgress =
				toIdx >= 0
					? Math.max(0, rawDragFraction - PILL_EXPANSION_THRESHOLD) / (1 - PILL_EXPANSION_THRESHOLD)
					: 0;
			pager.set({
				fractionalIndex: toIdx >= 0 ? centerTab + (toIdx - centerTab) * pillProgress : centerTab,
				dragging: publication.inFlight && this.#liveDragging,
				active: true,
				backMorph: rawDragFraction,
				targetIndex: null,
				transitionTarget: publication.toPathname
			});
			return;
		}
		// No centerTab: tab host (bidirectional), compose route, or deep page.
		// The pill interpolation is shared; the backMorph publication differs
		// by destination (see the docstring above for the five sub-cases).
		const fromIdx = inputs?.fromTabIndex ?? -1;
		const toIdx = this.#gestureToTabIndex ?? inputs?.toTabIndex ?? -1;
		const bidirectional = inputs?.bidirectional === true;
		// Non-tab target on a bidirectional host: the in-flight target is
		// not a tab root. Two reach paths: backward-to-deep-page
		// (`history.back` to /profile, /bookmarks, etc.) and the
		// forward-from-last-tab gesture whose target is `/search` (per
		// `#nextTabTarget`). The resolved `toTabIndex` is `#tabIndexFor(to)`,
		// which returns -1 for either path, so the pill has no destination
		// tab to interpolate toward and must HOLD at fromIdx while the
		// Header reacts to the published `backMorph` (the deep-page morph
		// for a backward gesture; the root<->search scrub for a forward
		// last-tab gesture, where the Header's `morph` derivation ignores
		// `backMorph` and the searchProgress / trackMorph derivation
		// consumes it).
		const targetPath = publication.toPathname;
		const targetIsDeepPage = targetPath !== null && getRouteData(targetPath).tag !== 'tab';
		const holdPillAtFromIdx = bidirectional && targetIsDeepPage;
		const pillToIdx = holdPillAtFromIdx ? fromIdx : toIdx;
		const pillProgress =
			pillToIdx >= 0
				? Math.max(0, rawDragFraction - PILL_EXPANSION_THRESHOLD) / (1 - PILL_EXPANSION_THRESHOLD)
				: 0;
		// backMorph: raw slide fraction when the target is not a tab (deep
		// host backward-exit, bidirectional backward-to-deep-page, or
		// bidirectional forward-last-tab-to-`/search`). null when both
		// source and target pill-map to a tab index (tab-to-tab on any host
		// type: the Header stays in hamburger mode throughout, including
		// offline LIST routes on NavPipelineHost that pill-map to a tab via
		// TAB_BAR_CONFIG).
		const backMorphValue =
			(bidirectional && !targetIsDeepPage) || (fromIdx >= 0 && toIdx >= 0) ? null : rawDragFraction;
		// targetIndex: null when the pill is held at fromIdx (a held pill
		// has no destination tab to highlight) or when the resolved
		// toTabIndex is -1 (no tab association).
		const targetIndexValue = holdPillAtFromIdx || pillToIdx < 0 ? null : pillToIdx;
		pager.set({
			fractionalIndex: pillToIdx >= 0 ? fromIdx + (pillToIdx - fromIdx) * pillProgress : fromIdx,
			dragging: publication.inFlight && this.#liveDragging,
			active: true,
			backMorph: backMorphValue,
			targetIndex: targetIndexValue,
			transitionTarget: publication.toPathname
		});
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
 *  shared singleton there is only ever one orchestrator instance, so this
 *  is a plain assignment of the active-slot pointer. */
export function setNavPipelineOrchestrator(orch: NavPipelineOrchestrator | null): void {
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
