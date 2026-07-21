// src/lib/stores/nav-state-machine-logic.ts
/**
 * Pure (runes-free) half of the Layer 1 orchestrator state machine.
 *
 * Per `docs/DV20-Plan.md` §2 Layer 1 + §6: owns the macro state of a
 * navigation transition and the page lifecycle. Macro phases:
 * `at-rest`, `intent`, `resolving`, `transitioning` (carrying the
 * active resolver + sub-phase), `landing`. The reducer models the
 * interruption (a new intent arriving mid-transition; §5). The sole
 * producer of the `interrupt` event is a gesture re-grab
 * mid-transition (`#beginGesture` in the orchestrator); popstate and
 * failed-preload are handled by the SvelteKit nav hooks
 * (`onSvelteKitBeforeNavigate` / `onSvelteKitAfterNavigate`), not
 * routed through the reducer's `interrupt` path.
 *
 * This module is the reducer; `nav-state-machine.svelte.ts` is the
 * thin `$state` wrapper that delegates every transition here. The
 * split mirrors the `page-cache-logic.ts` / `page-cache.svelte.ts`
 * pattern so this file is unit-testable under `bun:test` with no
 * Svelte runes loader.
 *
 * The reducer is TOTAL: every (state, event) pair has a defined
 * result. Interruption cancels the active commit and re-enters
 * `intent` with the new pointer (§5 interruption). SvelteKit interop
 * is exposed as hook methods on the reactive wrapper; they feed events
 * into this reducer.
 */

import type { RouteTag } from '$lib/utils/route-data';
import type { IntentState } from '$lib/utils/nav-intent';
import type { TransitionPlan } from '$lib/utils/nav-resolvers';

// ---------------------------------------------------------------------------
// Macro phase.

/** Where the state machine rests when no transition is in flight. The
 *  `on` field records which tag the current route carries so the
 *  reducer can emit the correct landing state. */
export type AtRestOn = 'tab' | 'deep' | 'search';

/** The sub-phase while transitioning: dragging, committing, cancelling. */
export type TransitionSub = 'dragging' | 'committing' | 'cancelling';

/** Macro phase kind. Per §2/§6: at-rest, intent (classified, plan not
 *  locked), resolving (reserved for async resolution),
 *  transitioning (animation in flight), landing. */
export type MacroPhaseKind = 'at-rest' | 'intent' | 'resolving' | 'transitioning' | 'landing';

/** The full macro phase record. `on` is populated for `at-rest` and
 *  `landing` (the surface the machine rests on or is landing toward);
 *  `sub` and `plan` are co-populated (both set together, or both null)
 *  for `transitioning`; for `intent` and `resolving` all three fields
 *  are null. Carrying the plan inside the phase record keeps the active
 *  plan authoritative for every consumer (§13.5: "the state machine is
 *  the only authority"). */
export interface MacroPhase {
	readonly kind: MacroPhaseKind;
	/** Populated when `kind === 'at-rest'` or `kind === 'landing'`
	 *  (the destination surface). Null otherwise. */
	readonly on: AtRestOn | null;
	/** Populated when `kind === 'transitioning'`. Null otherwise. */
	readonly sub: TransitionSub | null;
	/** Populated when `kind === 'transitioning'` (alongside `sub`).
	 *  Null otherwise. */
	readonly plan: TransitionPlan | null;
}

/** Direction of the in-flight transition. */
export type TransitionDirection = 'forward' | 'backward';

/** The full orchestrator state. One record; the consumers read this
 *  shape directly. The single `macro` phase (whose `macro.plan` carries
 *  the active transition plan) plus the resolved from/to/direction
 *  fields are the complete authority for the transition state. */
export interface OrchestratorState {
	readonly macro: MacroPhase;
	readonly fromPathname: string | null;
	readonly toPathname: string | null;
	readonly fromTag: RouteTag | null;
	readonly toTag: RouteTag | null;
	readonly direction: TransitionDirection | null;
}

// ---------------------------------------------------------------------------
// Events.

/** A gesture-start intent arrived (drag decided or target bearing). */
export interface IntentEventPayload {
	readonly type: 'intent';
	readonly intent: IntentState;
	readonly from: string;
	readonly fromTag: RouteTag;
}

/** The resolver produced a plan; enter `transitioning`. */
export interface ResolvedEventPayload {
	readonly type: 'resolved';
	readonly plan: TransitionPlan;
	readonly from: string;
	readonly to: string;
	readonly fromTag: RouteTag;
	readonly toTag: RouteTag;
	readonly direction: TransitionDirection;
}

/** The live drag moved. */
export interface DragMoveEventPayload {
	readonly type: 'drag-move';
	readonly intent: IntentState;
}

/** The drag committed (released past the threshold). */
export interface CommitEventPayload {
	readonly type: 'commit';
}

/** The drag was cancelled (released below the threshold). */
export interface CancelEventPayload {
	readonly type: 'cancel';
}

/** A new intent arrived mid-transition (§5 interruption). */
export interface InterruptEventPayload {
	readonly type: 'interrupt';
	readonly intent: IntentState;
}

/** The navigation landed; go to `landing` then `at-rest`. */
export interface LandEventPayload {
	readonly type: 'land';
	readonly on: AtRestOn;
}

/** Reset to at-rest on a tag. */
export interface ResetEventPayload {
	readonly type: 'reset';
	readonly on: AtRestOn;
}

/** All events the reducer accepts. */
export type OrchestratorEvent =
	| IntentEventPayload
	| ResolvedEventPayload
	| DragMoveEventPayload
	| CommitEventPayload
	| CancelEventPayload
	| InterruptEventPayload
	| LandEventPayload
	| ResetEventPayload;

// ---------------------------------------------------------------------------
// Initial state + helpers.

/** Build an at-rest macro phase for the given tag. */
export function atRestPhase(on: AtRestOn): MacroPhase {
	return { kind: 'at-rest', on, sub: null, plan: null };
}

/** Build an initial state at rest on the given tag. The first load
 *  has no prior transition; the orchestrator starts here. */
export function initialOrchestratorState(on: AtRestOn = 'tab'): OrchestratorState {
	return {
		macro: atRestPhase(on),
		fromPathname: null,
		toPathname: null,
		fromTag: null,
		toTag: null,
		direction: null
	};
}

/** Convert a tag to the at-rest surface. */
export function atRestOnFor(tag: RouteTag): AtRestOn {
	if (tag === 'tab') return 'tab';
	if (tag === 'search') return 'search';
	return 'deep';
}

// ---------------------------------------------------------------------------
// The reducer.
//
// Total: every (state, event) pair has a defined result. The reducer
// does not throw on out-of-sequence events (e.g. a `commit` arriving
// while at rest); it returns the unchanged state for those.

export function reduce(state: OrchestratorState, event: OrchestratorEvent): OrchestratorState {
	switch (event.type) {
		case 'intent': {
			// A gesture-start intent arrives. From at-rest we enter
			// `intent`; from transitioning this is folded into the
			// active transition (treated as an interrupt by the
			// `interrupt` event, not this one).
			if (state.macro.kind === 'at-rest') {
				return {
					...state,
					macro: { kind: 'intent', on: null, sub: null, plan: null },
					fromPathname: event.from,
					fromTag: event.fromTag,
					toPathname: null,
					toTag: null,
					direction: null
				};
			}
			if (state.macro.kind === 'landing') {
				// A new intent arriving during landing re-enters intent.
				return {
					...state,
					macro: { kind: 'intent', on: null, sub: null, plan: null },
					fromPathname: event.from,
					fromTag: event.fromTag,
					toPathname: null,
					toTag: null,
					direction: null
				};
			}
			return state;
		}
		case 'resolved': {
			// The resolver produced a plan. Move to `transitioning`
			// with sub `dragging` (the gesture is live); PRESERVE
			// `committing` if re-resolved mid-commit (a committed
			// transition that re-resolves stays committed). Lock FROM/TO.
			if (state.macro.kind !== 'intent' && state.macro.kind !== 'transitioning') {
				return state;
			}
			const sub: TransitionSub =
				state.macro.kind === 'transitioning' && state.macro.sub === 'committing'
					? 'committing'
					: 'dragging';
			return {
				...state,
				macro: { kind: 'transitioning', on: null, sub, plan: event.plan },
				fromPathname: event.from,
				fromTag: event.fromTag,
				toPathname: event.to,
				toTag: event.toTag,
				direction: event.direction
			};
		}
		case 'drag-move': {
			// Live drag moved. No reducer state changes: the live drag
			// fraction is owned by the orchestrator's executor, not
			// persisted in the reducer. The event remains in the protocol
			// so the reducer stays total over the wrapper's dispatch set.
			return state;
		}
		case 'commit': {
			// Released past threshold: enter committing.
			if (state.macro.kind !== 'transitioning') return state;
			if (state.macro.sub !== 'dragging') return state;
			return {
				...state,
				macro: {
					kind: 'transitioning',
					on: null,
					sub: 'committing',
					plan: state.macro.plan
				}
			};
		}
		case 'cancel': {
			// Released below threshold: enter cancelling, then land
			// back on FROM. The orchestrator emits `land` after the
			// cancel animation completes. The plan's progressDirection
			// flips to 1 (cancel, target FROM) to match the executor's
			// onCancel (which flips its own plan copy for the commit
			// integrator's target). This keeps the state machine the
			// sole authority for the plan (§13.5): a consumer reading
			// publication.plan.progressDirection during the cancel sees
			// the cancel direction, not the resolved commit direction.
			if (state.macro.kind !== 'transitioning') return state;
			if (state.macro.sub !== 'dragging') return state;
			return {
				...state,
				macro: {
					kind: 'transitioning',
					on: null,
					sub: 'cancelling',
					plan: state.macro.plan === null ? null : { ...state.macro.plan, progressDirection: 1 }
				}
			};
		}
		case 'interrupt': {
			// §5 interruption: a new intent arrives mid-transition, during
			// any transitioning sub (dragging, committing, or cancelling).
			// Cancel the in-flight transition and re-enter
			// `intent`. FROM is unchanged (the user is still on the FROM
			// page); TO/direction are abandoned and must be cleared so an
			// `intent` phase never carries a stale destination (mirrors
			// the intent-from-at-rest and intent-from-landing branches).
			if (state.macro.kind !== 'transitioning') return state;
			return {
				...state,
				macro: { kind: 'intent', on: null, sub: null, plan: null },
				fromPathname: state.fromPathname,
				fromTag: state.fromTag,
				toPathname: null,
				toTag: null,
				direction: null
			};
		}
		case 'land': {
			return {
				...state,
				macro: { kind: 'landing', on: event.on, sub: null, plan: null }
			};
		}
		case 'reset': {
			// Reset to at-rest. Fires from landing (the wrapper's
			// microtask lands here) or at-rest (idempotent). Phases we
			// DO NOT clobber:
			//  - `intent`: a new gesture arrived during the landing
			//    microtask window (the state moved landing -> intent,
			//    and the stale microtask must not abort that new gesture).
			//  - `transitioning`: the finish-then-new queued-nav replay
			//    dispatches synchronously from `landing` through `intent`
			//    to `transitioning` before this microtask drains. The
			//    reset must not overwrite that in-flight transition.
			if (state.macro.kind === 'intent' || state.macro.kind === 'transitioning') {
				return state;
			}
			return initialOrchestratorState(event.on);
		}
		default:
			return state;
	}
}
