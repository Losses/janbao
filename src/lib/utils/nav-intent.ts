// src/lib/utils/nav-intent.ts
/**
 * Layer 2 of the DV20 mobile-navigation pipeline: the intent classifier.
 *
 * Per `docs/DV20-Plan.md` §2 Layer 2: maps raw input (pointer events,
 * taps, popstate, hashchange, programmatic goto) to an intent plus
 * continuous parameters (direction, live offset, live velocity).
 *
 * Pure (runes-free). No side effects, no DOM reads, no DOM writes. The
 * orchestrator (Layer 1, `nav-state-machine.svelte.ts`) subscribes to
 * the classified intent and publishes it downward to the resolver
 * (Layer 3).
 *
 * The classifier is a state machine over `(IntentState, IntentEvent)`.
 * Micro states per §6: `idle`, `deciding`, `drag-left`, `drag-right`,
 * `committed`, `cancelled`. The continuous parameters (`offset`,
 * `velocity`) live ON the state record; the orchestrator reads them
 * each frame as the live input streams.
 *
 * The 40px edge-dead-zone (matching the existing `detectSwipe` action)
 * is a parameter the caller supplies; this module does not read window
 * dimensions or matchMedia. The caller also supplies the clock so unit
 * tests are deterministic.
 *
 * This module is imported by the reactive orchestrator, by its own
 * unit suite, and (in Cycle 5) by the wiring layer that bridges
 * `detectSwipe` events to `IntentEvent`. In Cycle 3 nothing consumes
 * it; it stands alone.
 */

/** Edge-dead-zone: the 40px gutter (matching the existing `detectSwipe`
 *  action's behaviour) that ignores the OS edge-back gesture.
 *  Caller-supplied so this module is pure. */
export interface EdgeDeadZone {
	/** Pixels from the left edge treated as the OS gesture reserve. */
	readonly left: number;
	/** Pixels from the right edge treated as the OS gesture reserve. */
	readonly right: number;
}

export const DEFAULT_EDGE_DEAD_ZONE: EdgeDeadZone = { left: 40, right: 40 };

/** Drag-decision threshold: the minimum horizontal travel (matching
 *  the existing `detectSwipe` action) before a drag is claimed as a
 *  gesture. Below this the classifier stays in `deciding`. */
export const DEFAULT_DECIDE_THRESHOLD_PX = 10;

/** Number of trailing move samples used for the release-velocity
 *  estimate. Matches the existing `detectSwipe` action's shape (a
 *  small ring of recent samples, not a global average). */
export const VELOCITY_SAMPLE_COUNT = 5;

/** Micro state of the intent classifier. §6 lists these as the Layer 2
 *  micro states: idle, deciding, drag-left, drag-right, committed,
 *  cancelled. */
export type IntentMicro =
	| 'idle'
	| 'deciding'
	| 'drag-left'
	| 'drag-right'
	| 'committed'
	| 'cancelled';

/** Gross direction of the in-flight gesture. `null` while deciding. */
export type IntentDirection = 'left' | 'right' | null;

/** The kind of raw input that produced an `IntentEvent`. Mirrors §2
 *  Layer 2's enumerated sources. */
export type IntentEventKind =
	| 'pointerdown'
	| 'pointermove'
	| 'pointerup'
	| 'pointercancel'
	| 'tap'
	| 'popstate'
	| 'hashchange'
	| 'goto';

/** A single raw input event. The classifier is event-driven: the
 *  caller hands it each pointer / navigation event in chronological
 *  order. The `x` and `t` fields are caller-supplied so the classifier
 *  stays pure (no `performance.now()` reads inside). */
export interface IntentEvent {
	readonly kind: IntentEventKind;
	readonly x: number;
	readonly y: number;
	readonly t: number;
	readonly target: string | null;
}

/** Internal ring-buffer entry for the trailing-velocity estimate. */
interface VelocitySample {
	readonly x: number;
	readonly t: number;
}

/** The classifier's full state record. Per §2 Layer 2 the record
 *  carries the micro state AND the continuous parameters the resolver
 *  and executor read each frame. */
export interface IntentState {
	readonly micro: IntentMicro;
	readonly direction: IntentDirection;
	/** Signed drag offset (px) from the gesture start. Positive = right. */
	readonly offset: number;
	/** Live velocity (px/ms). Updated on each move; frozen at release. */
	readonly velocity: number;
	/** Gesture start X (px). Caller's coordinate space. */
	readonly startX: number;
	/** Gesture start time (ms, caller's clock). */
	readonly startedAt: number;
	/** True when the user reversed the drag past the start (a cancel
	 *  hint). The resolver reads this to pick `progressDirection`. */
	readonly reversed: boolean;
	/** Pathname for a tap/goto/popstate target. `null` while dragging. */
	readonly target: string | null;
	/** Velocity captured at release. Same as `velocity` after release;
	 *  kept as a separate field so the executor can read it after the
	 *  move stream has stopped without aliasing future mutations. */
	readonly releaseVelocity: number;
	/** Trailing ring buffer of move samples used to compute the
	 *  velocity. Bounded by `VELOCITY_SAMPLE_COUNT`. */
	readonly samples: readonly VelocitySample[];
}

/** Initial state. */
export function initialIntentState(): IntentState {
	return {
		micro: 'idle',
		direction: null,
		offset: 0,
		velocity: 0,
		startX: 0,
		startedAt: 0,
		reversed: false,
		target: null,
		releaseVelocity: 0,
		samples: []
	};
}

/** Pure constructor parameters for the classifier. The caller supplies
 *  the dead-zone and decision thresholds so unit tests are
 *  deterministic and the module does not read window dimensions. */
export interface IntentClassifierOptions {
	readonly edgeDeadZone: EdgeDeadZone;
	readonly decideThresholdPx: number;
}

export const DEFAULT_CLASSIFIER_OPTIONS: IntentClassifierOptions = {
	edgeDeadZone: DEFAULT_EDGE_DEAD_ZONE,
	decideThresholdPx: DEFAULT_DECIDE_THRESHOLD_PX
};

/** A target the classifier can produce. The orchestrator matches this
 *  against the current route to compute the (from, to) pair.
 *  `via` is `'goto'` for all Cycle-3 shadow-mode navigations; Cycle 5
 *  will discriminate tap / popstate / hashchange when it wires the
 *  real SvelteKit event sources into the orchestrator. */
export interface ResolvedTarget {
	readonly pathname: string;
	readonly via: 'goto';
}

/** Append a sample to the ring buffer, bounded to
 *  `VELOCITY_SAMPLE_COUNT`. Pure (returns a new array). */
function appendSample(
	samples: readonly VelocitySample[],
	sample: VelocitySample
): readonly VelocitySample[] {
	const next = samples.concat(sample);
	if (next.length <= VELOCITY_SAMPLE_COUNT) return next;
	return next.slice(next.length - VELOCITY_SAMPLE_COUNT);
}

/** Estimate velocity (px/ms) from the trailing samples. Uses the
 *  first-to-last delta over the first-to-last time, matching the
 *  existing `detectSwipe` action's estimator shape. Returns 0 when
 *  there are fewer than two samples or the time delta is non-positive. */
export function estimateVelocity(samples: readonly VelocitySample[]): number {
	if (samples.length < 2) return 0;
	const first = samples[0];
	const last = samples[samples.length - 1];
	const dt = last.t - first.t;
	if (dt <= 0) return 0;
	return (last.x - first.x) / dt;
}

/** Whether a pointerdown at `x` falls inside the OS edge-back reserve.
 *  The classifier ignores these so the OS gesture fires cleanly. */
export function isEdgeReserve(x: number, viewportWidth: number, deadZone: EdgeDeadZone): boolean {
	if (x <= deadZone.left) return true;
	if (viewportWidth - x <= deadZone.right) return true;
	return false;
}

/** Resolve a drag direction from a current offset relative to start.
 *  Positive offset = rightward drag, negative = leftward. Returns
 *  `null` while the magnitude is below the decision threshold. */
export function resolveDirection(deltaX: number, decideThresholdPx: number): IntentDirection {
	const magnitude = Math.abs(deltaX);
	if (magnitude < decideThresholdPx) return null;
	return deltaX > 0 ? 'right' : 'left';
}

/**
 * The intent classifier. Pure reducer: given the current state and an
 * event, returns the next state. The orchestrator applies external
 * side effects (SvelteKit navigation, rAF scheduling); this function
 * decides ONLY the next intent state.
 *
 * Behaves as follows:
 *
 *   - `pointerdown`: enters `deciding`. Records start X/time. If
 *      inside the edge reserve, stays in `idle` (the OS owns the
 *      gesture).
 *   - `pointermove`: in `deciding`, transitions to `drag-left`/
 *      `drag-right` once the offset exceeds the threshold. In a drag
 *      state, updates the offset/velocity/samples. Detects a reversal
 *      (sign flip past the start).
 *   - `pointerup`: in a drag state, transitions to `committed` (or
 *      `cancelled` if reversed and below the commit threshold). Freezes
 *      the release velocity.
 *   - `pointercancel`: transitions to `cancelled`.
 *   - `tap` / `goto` / `popstate` / `hashchange`: produces a target
 *      intent with `micro: 'committed'` and `target: pathname`. The
 *      orchestrator resolves this into a (from, to) pair.
 */
export function classify(
	state: IntentState,
	event: IntentEvent,
	opts: IntentClassifierOptions,
	viewportWidth: number
): IntentState {
	switch (event.kind) {
		case 'pointerdown': {
			if (isEdgeReserve(event.x, viewportWidth, opts.edgeDeadZone)) {
				// The OS owns the edge-back gesture; we yield.
				return initialIntentState();
			}
			return {
				micro: 'deciding',
				direction: null,
				offset: 0,
				velocity: 0,
				startX: event.x,
				startedAt: event.t,
				reversed: false,
				target: null,
				releaseVelocity: 0,
				samples: [{ x: event.x, t: event.t }]
			};
		}
		case 'pointermove': {
			if (state.micro === 'idle') return state;
			if (
				state.micro !== 'deciding' &&
				state.micro !== 'drag-left' &&
				state.micro !== 'drag-right'
			) {
				return state;
			}
			const offsetX = event.x - state.startX;
			const samples = appendSample(state.samples, { x: event.x, t: event.t });
			const velocity = estimateVelocity(samples);
			const direction =
				state.micro === 'drag-left' || state.micro === 'drag-right'
					? state.direction
					: resolveDirection(offsetX, opts.decideThresholdPx);
			const micro: IntentMicro =
				direction === null ? 'deciding' : direction === 'right' ? 'drag-right' : 'drag-left';
			const reversed =
				state.micro !== 'deciding' &&
				((state.micro === 'drag-right' && offsetX < 0) ||
					(state.micro === 'drag-left' && offsetX > 0));
			return {
				...state,
				micro,
				direction,
				offset: offsetX,
				velocity,
				reversed,
				samples
			};
		}
		case 'pointerup': {
			if (state.micro === 'deciding') {
				// Below threshold: treat as a no-op (the caller may
				// still synthesize a tap).
				return initialIntentState();
			}
			if (state.micro !== 'drag-left' && state.micro !== 'drag-right') {
				return state;
			}
			const releaseVelocity = state.velocity;
			const reversed = state.reversed;
			const micro: IntentMicro = reversed ? 'cancelled' : 'committed';
			return { ...state, micro, releaseVelocity, velocity: releaseVelocity, reversed };
		}
		case 'pointercancel': {
			if (state.micro === 'idle') return state;
			return { ...state, micro: 'cancelled' };
		}
		case 'tap':
		case 'popstate':
		case 'hashchange':
		case 'goto': {
			if (event.target === null) return state;
			return {
				...initialIntentState(),
				micro: 'committed',
				target: event.target,
				startedAt: event.t
			};
		}
		default:
			return state;
	}
}

/** Convenience: extract the target from an intent, if any. The
 *  orchestrator uses this to look up the destination's RouteData. */
export function intentTarget(intent: IntentState): ResolvedTarget | null {
	if (intent.target === null) return null;
	return { pathname: intent.target, via: 'goto' };
}
