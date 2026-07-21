// src/lib/stores/nav-state-machine.svelte.ts
/**
 * Layer 1 reactive wrapper around the pure orchestrator reducer in
 * `nav-state-machine-logic.ts`.
 *
 * Per `docs/DV20-Plan.md` §2 Layer 1 + §9: the orchestrator owns the
 * macro state of a navigation transition and the SvelteKit interop
 * boundary. It does NOT touch the DOM (the executor owns that); it
 * models the macro phases the orchestrator dispatches to. Every
 * mobile gesture route mounts a pipeline host whose orchestrator feeds
 * this store; there is no parallel gesture state machine.
 *
 * The wrapper is a thin `$state` shell with FOUR mutation methods:
 * `dispatch()` delegates every transition event to the pure reducer
 * (the authority for the phase maths); `forceReset()` performs a
 * direct overwrite with `initialOrchestratorState(on)`, used by
 * `configure()` on a fresh host mount to clear state a prior route may
 * have left in any phase; `setSettleState()` writes the settle fields
 * (active / progress / latched / direction / awaitTitle); and
 * `setSearchScrubbing()` writes the search-scrub flag. The orchestrator
 * reads the state through `$derived` and register as dependents on the
 * underlying `$state`.
 *
 * Module-singleton pattern, matching the other stores in this
 * directory (e.g. `page-cache.svelte.ts`, `mobile-pager.svelte.ts`):
 * the root layout (an ancestor of every reader) cannot read a context
 * a descendant sets, so we use a module singleton rather than
 * `getContext`/`setContext`.
 *
 * This store stands alone as the state-machine authority; the
 * orchestrator dispatches events to it from SvelteKit's
 * `beforeNavigate` / `afterNavigate` hooks, calls `setSettleState`
 * from the settle rAF tick / settle-arm / settle-end / awaitTitle-clear
 * paths, and calls `setSearchScrubbing` from the tap-scrub arm / finish
 * paths.
 */

import { browser } from '$app/environment';
import {
	atRestOnFor,
	initialOrchestratorState,
	reduce,
	type AtRestOn,
	type OrchestratorEvent,
	type OrchestratorState
} from './nav-state-machine-logic';
import type { IntentState } from '$lib/utils/nav-intent';
import type { RouteTag } from '$lib/utils/route-data';
import type { TransitionDirection, TransitionPlan } from '$lib/utils/nav-resolvers';
import type { HeaderSettleTransition } from '$lib/utils/header-probe';

/** Constructor options. The wrapper is SSR-safe (no events arrive
 *  during SSR so the reducer is never called). */
export interface NavStateMachineOptions {
	/** Initial at-rest surface. Defaults to 'tab' (the discussions
	 *  list is the canonical entry). */
	readonly initialOn?: AtRestOn;
}

/** Partial settle state update. Each field is optional; unspecified fields
 *  preserve their prior value. Passed to `NavStateMachine.setSettleState` by
 *  the orchestrator's settle rAF tick, settle-arm, and settle-end paths. */
interface SettleStateUpdate {
	active?: boolean;
	progress?: number;
	latched?: HeaderSettleTransition | null;
	direction?: 'forward' | 'back';
	awaitTitle?: boolean;
}

export class NavStateMachine {
	#state = $state<OrchestratorState>(initialOrchestratorState('tab'));

	// ------------------------------------------------------------------
	// Settle + tap-scrub micro animation state. Per §13.5 the state
	// machine is the sole authority for consumer-visible state. The
	// orchestrator owns the settle / tap-scrub rAFs (the motion
	// channels) and writes the per-frame values here; the orchestrator's
	// `$derived` publication merges them with the macro phase for
	// consumers (the Header). Stored on the state machine, not on the
	// orchestrator's private class `$state`, so consumers read from ONE
	// authority.
	#settleActive = $state(false);
	#settleProgress = $state(1);
	#settleLatched = $state<HeaderSettleTransition | null>(null);
	#settleDirection = $state<'forward' | 'back'>('forward');
	#settleAwaitTitle = $state(false);
	#searchScrubbing = $state(false);

	constructor(opts: NavStateMachineOptions = {}) {
		if (opts.initialOn) {
			this.#state = initialOrchestratorState(opts.initialOn);
		}
	}

	/** Reactive read of the full state record. Consumers read fields
	 *  off this in a `$derived` to register as dependents. */
	get state(): OrchestratorState {
		return this.#state;
	}

	// ------------------------------------------------------------------
	// Settle + tap-scrub reactive reads. The orchestrator's publication
	// merges these into the consumer-facing record; the Header reads
	// them via the orchestrator's getters (pass-throughs to this
	// authority).

	/** True while the orchestrator's settle ease owns the morph / title
	 *  crossfade. Read by the Header's morph / titleView derivations via
	 *  the orchestrator's publication. */
	get settleActive(): boolean {
		return this.#settleActive;
	}
	/** The eased settle progress 0..1. Read by the Header's morph /
	 *  titleView derivations via the orchestrator's publication. */
	get settleProgress(): number {
		return this.#settleProgress;
	}
	/** The latched endpoint identity of the in-flight settle. null at
	 *  rest. Read by the Header's morph / titleView derivations via the
	 *  orchestrator's publication. */
	get settleLatched(): HeaderSettleTransition | null {
		return this.#settleLatched;
	}
	/** The direction of the in-flight settle (forward / back). Read by
	 *  the Header's titleView to pick the title-span slide axis. */
	get settleDirection(): 'forward' | 'back' {
		return this.#settleDirection;
	}
	/** True while a commit settle holds at progress 1 awaiting the
	 *  navigation to land. Read by the DEV probe. */
	get settleAwaitTitle(): boolean {
		return this.#settleAwaitTitle;
	}
	/** True while the orchestrator's tap-scrub ease is in flight. Read
	 *  by the Header's `iconProgress` derivation to freeze the hamburger
	 *  icon on a tab-root page while the search-layout scrub runs. */
	get searchScrubbing(): boolean {
		return this.#searchScrubbing;
	}

	/** Write the settle state. Each field is optional; unspecified fields
	 *  preserve their prior value. Called by the orchestrator's settle
	 *  rAF tick (progress only), settle-arm (all fields), settle-end
	 *  (clear active + latched + awaitTitle), awaitTitle-only clears
	 *  from `onSvelteKitAfterNavigate` and `notifyHeaderState`, and
	 *  `unmount` (clears active + latched + awaitTitle and resets
	 *  progress to 1 so the next mount starts at rest). */
	setSettleState(update: SettleStateUpdate): void {
		if (update.active !== undefined) this.#settleActive = update.active;
		if (update.progress !== undefined) this.#settleProgress = update.progress;
		if (update.latched !== undefined) this.#settleLatched = update.latched;
		if (update.direction !== undefined) this.#settleDirection = update.direction;
		if (update.awaitTitle !== undefined) this.#settleAwaitTitle = update.awaitTitle;
	}

	/** Write the search-scrub flag. Called by the orchestrator's
	 *  tap-scrub arm / finish paths. */
	setSearchScrubbing(value: boolean): void {
		this.#searchScrubbing = value;
	}

	/** Dispatch an event through the reducer. One of the wrapper's four
	 *  mutation methods: `dispatch` and `forceReset` both assign `#state`
	 *  directly (whole-state), while `setSettleState` and
	 *  `setSearchScrubbing` write individual `$state` fields. Every
	 *  transition event routes through here so the reducer stays the
	 *  authority for the phase maths. The wrapper does not branch on
	 *  event types itself; it builds the event payload and delegates. */
	dispatch(event: OrchestratorEvent): void {
		// Assign through `$state` so dependents on `state` / `macro`
		// / `fromPathname` re-run. The reducer may return the same
		// reference for no-op events (e.g. `drag-move`, whose live
		// fraction is owned by the orchestrator's executor, not the
		// reducer); that is fine because the orchestrator's
		// `#publication` re-runs via `#progress` for drag updates, and
		// every state-changing event returns a fresh record.
		this.#state = reduce(this.#state, event);
	}

	// -----------------------------------------------------------------------
	// SvelteKit interop boundary.
	//
	// Methods the orchestrator wires into SvelteKit's `beforeNavigate`,
	// `afterNavigate`, and the popstate listener. They feed events
	// into the reducer but do not touch SvelteKit's navigation API
	// (the wrapper has no `goto` import).

	/** A gesture-start intent arrived from the classifier. */
	onIntent(intent: IntentState, from: string, fromTag: RouteTag): void {
		this.dispatch({ type: 'intent', intent, from, fromTag });
	}

	/** The resolver produced a plan. Lock FROM/TO and enter
	 *  transitioning. */
	onResolved(
		plan: TransitionPlan,
		from: string,
		to: string,
		fromTag: RouteTag,
		toTag: RouteTag,
		direction: TransitionDirection
	): void {
		this.dispatch({ type: 'resolved', plan, from, to, fromTag, toTag, direction });
	}

	/** The live drag moved. */
	onDragMove(intent: IntentState): void {
		this.dispatch({ type: 'drag-move', intent });
	}

	/** The drag committed (released past the threshold). */
	onCommit(): void {
		this.dispatch({ type: 'commit' });
	}

	/** The drag was cancelled (released below the threshold). */
	onCancel(): void {
		this.dispatch({ type: 'cancel' });
	}

	/** A new intent arrived mid-transition (§5 interruption). */
	onInterrupt(intent: IntentState): void {
		this.dispatch({ type: 'interrupt', intent });
	}

	/** The navigation landed. The wrapper schedules the brief landing
	 *  phase followed by the at-rest transition. */
	onLand(toTag: RouteTag): void {
		const on = atRestOnFor(toTag);
		this.dispatch({ type: 'land', on });
		// The landing phase is a single microtask: the wrapper settles
		// into at-rest on the next tick so consumers observe the
		// landing state for one render. Browser-only because SSR has
		// no navigation events.
		if (browser) {
			queueMicrotask(() => this.dispatch({ type: 'reset', on }));
		} else {
			this.dispatch({ type: 'reset', on });
		}
	}

	/** Unconditionally reset to at-rest on a tag, bypassing the
	 *  `intent` guard on the `reset` event. Used by a fresh
	 *  orchestrator mount to clear stale state left by a prior mount
	 *  (the singleton state machine survives across orchestrator
	 *  construction/teardown; a prior route's transition may have
	 *  left the machine in any phase, including `intent`). */
	forceReset(on: AtRestOn): void {
		this.#state = initialOrchestratorState(on);
	}
}

let instance: NavStateMachine | undefined;

/** The single shared `NavStateMachine`. Module singleton, matching the
 *  standard store pattern in this directory. */
export function getNavStateMachine(): NavStateMachine {
	if (!instance) {
		instance = new NavStateMachine();
	}
	return instance;
}
