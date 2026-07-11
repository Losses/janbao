// src/lib/stores/nav-state-machine.svelte.ts
/**
 * Layer 1 reactive wrapper around the pure orchestrator reducer in
 * `nav-state-machine-logic.ts`.
 *
 * Per `docs/DV20-Plan.md` §2 Layer 1 + §9: the orchestrator owns the
 * macro state of a navigation transition and the SvelteKit interop
 * boundary. It does NOT touch the DOM (the executor owns that); it
 * does NOT replace the existing MobileTabPager or GesturePageLayout
 * (the 5b2 migration replaces them; this store models the macro
 * phases the orchestrator dispatches to).
 *
 * The wrapper is a thin `$state` shell: every transition delegates to
 * the pure reducer so the reducer is the single source of truth for
 * the phase maths. The orchestrator reads the state through
 * `$derived` and register as dependents on the underlying `$state`.
 *
 * Module-singleton pattern, matching the other stores in this
 * directory (e.g. `page-cache.svelte.ts`, `mobile-pager.svelte.ts`):
 * the root layout (an ancestor of every reader) cannot read a context
 * a descendant sets, so we use a module singleton rather than
 * `getContext`/`setContext`.
 *
 * This store stands alone as the state-machine authority; the
 * orchestrator dispatches events to it from SvelteKit's
 * `beforeNavigate` / `afterNavigate` hooks.
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

/** A clock function returning epoch milliseconds. Injectable so unit
 *  tests are deterministic. */
export type NavClockFn = () => number;

/** Constructor options. The clock is injectable for deterministic
 *  tests; the default is `Date.now`. The wrapper is SSR-safe (no
 *  events arrive during SSR so the reducer is never called). */
export interface NavStateMachineOptions {
	readonly now?: NavClockFn;
	/** Initial at-rest surface. Defaults to 'tab' (the discussions
	 *  list is the canonical entry). */
	readonly initialOn?: AtRestOn;
}

/** Internal alias kept for the private field type. */
type ClockFn = NavClockFn;

export class NavStateMachine {
	#state = $state<OrchestratorState>(initialOrchestratorState('tab'));
	readonly #now: ClockFn;

	constructor(opts: NavStateMachineOptions = {}) {
		this.#now = opts.now ?? (() => Date.now());
		if (opts.initialOn) {
			this.#state = initialOrchestratorState(opts.initialOn);
		}
	}

	/** Reactive read of the full state record. Consumers read fields
	 *  off this in a `$derived` to register as dependents. */
	get state(): OrchestratorState {
		return this.#state;
	}

	/** Reactive read of the current macro phase. Convenience for
	 *  consumers that only care about the phase. */
	get macro() {
		return this.#state.macro;
	}

	/** Reactive read of the active plan. Null unless a transition is
	 *  in flight. */
	get activePlan(): TransitionPlan | null {
		return this.#state.activePlan;
	}

	/** Reactive read of the FROM pathname. */
	get fromPathname(): string | null {
		return this.#state.fromPathname;
	}

	/** Reactive read of the TO pathname. */
	get toPathname(): string | null {
		return this.#state.toPathname;
	}

	/** Reactive read of the transition direction. */
	get direction(): TransitionDirection | null {
		return this.#state.direction;
	}

	/** Dispatch an event through the reducer. Single mutation point:
	 *  every transition routes through here so the reducer stays the
	 *  authority. The wrapper does not branch on event types itself;
	 *  it builds the event payload and delegates. */
	dispatch(event: OrchestratorEvent): void {
		// Replace the whole record so dependents on `state`/`macro`/
		// `activePlan` etc re-run. The reducer returns a fresh
		// `OrchestratorState`; assigning it through `$state` notifies
		// every reactive reader.
		this.#state = reduce(this.#state, event, this.#now());
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

	/** Reset to at-rest on a tag. A public boundary with no internal
	 *  caller: the first-load landing and the SSR initial render both
	 *  use the constructor's `initialOn` directly, and `onLand`
	 *  dispatches the reset event itself rather than calling this
	 *  method. Exposed for external callers that need to force-clear
	 *  the state machine outside a land cycle. The `reset` event
	 *  guards against clobbering an `intent` phase (a new gesture
	 *  that arrived during the landing microtask); use `forceReset`
	 *  when the caller needs an unconditional clear. */
	reset(on: AtRestOn): void {
		this.dispatch({ type: 'reset', on });
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

/** Test-only: replace the singleton. The unit suite for the pure
 *  reducer does not need this (it tests the reducer directly); it is
 *  exposed for future integration tests that want a fresh machine. */
export function __setNavStateMachine(next: NavStateMachine | undefined): void {
	instance = next;
}
