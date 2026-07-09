// src/lib/utils/nav-executor-logic.ts
/**
 * Pure (runes-free) half of the Layer 5 executor. The reactive shell
 * `nav-executor.svelte.ts` owns the rAF loop and the `$state` record;
 * it delegates every per-frame decision to this module so the
 * integrator + per-frame math run under `bun:test` with no Svelte
 * runes loader (mirroring the pure-logic / reactive-shell split -
 * `bun-test-no-runes-loader` memory).
 *
 * Per `docs/DV20-Plan.md` §5 + the C04 spec: a single rAF loop driven
 * by the orchestrator's phase writes the per-frame visual for every
 * consumer (page track, FAB, Header) through an injected
 * `NavDomDriver`. The commit phase uses a velocity-matched momentum
 * integral (variable duration), NOT a hardcoded ease. Reduced-motion
 * snaps. Interruption cancels the commit and hands off from the
 * current visual state with no jump. The executor publishes
 * authoritative state; there is no DOM read-back (§13.5).
 *
 * This module is exercised by its own unit suite
 * (`nav-executor-logic.test.ts`) using a `MockNavDomDriver`. The
 * reactive shell wires the rAF loop; the orchestrator (5b1) connects
 * its phase events to the shell's boundary methods.
 */

import type { TransitionPlan } from './nav-resolvers';
import type { NavDomDriver, NavVisualWrite } from './nav-dom-driver';

// ---------------------------------------------------------------------------
// Tuning constants. The defaults follow the C04 spec: variable
// duration (fast flick = few frames; slow release = longer ease),
// near-zero fallback, high-velocity clamp. The unit suite exercises
// each branch by overriding the inputs (not the constants).

/** Minimum commit duration (ms). Fast flick settles in at least this
 *  long, regardless of how high the release velocity is. */
export const COMMIT_T_MIN_MS = 100;

/** Maximum commit duration (ms). Slow release settles in at most this
 *  long; longer would feel sluggish. */
export const COMMIT_T_MAX_MS = 600;

/** Fallback commit duration (ms) when the release velocity is below
 *  `COMMIT_VELOCITY_EPSILON_PX_PER_MS` OR points away from the target.
 *  Matches the C04 spec's "default ease" fallback. */
export const COMMIT_T_DEFAULT_MS = 300;

/** Below this magnitude (px/ms) the release velocity is treated as
 *  near-zero and the default ease duration is used. */
export const COMMIT_VELOCITY_EPSILON_PX_PER_MS = 0.05;

/** Velocity magnitude ceiling (px/ms). Release velocities above this
 *  are clamped before being mapped to a commit duration, so an
 *  absurdly fast flick does not produce a sub-frame settle. */
export const COMMIT_VELOCITY_CLAMP_PX_PER_MS = 5;

// ---------------------------------------------------------------------------
// Executor state.

/** The executor's local phase. A projection of the orchestrator's
 *  state in `nav-state-machine-logic.ts` (NOT a subset - `'idle'` and
 *  `'live'` are executor-only values; they do not exist in
 *  `TransitionSub`):
 *  - `'idle'`: no transition in flight, OR reduced-motion snap, OR
 *    post-interrupt handoff point.
 *  - `'live'`: the drag is live (orchestrator sub `dragging` or
 *    `scrubbing`); each pointermove publishes directly.
 *  - `'committing'`: the commit rAF loop is integrating (orchestrator
 *    sub `committing` or `cancelling`).
 *
 *  The orchestrator's record stays the authority for the broader
 *  navigation; this local phase tracks only what the rAF loop needs to
 *  know (whether to sample a commit frame or to idle). */
export type ExecutorPhase = 'idle' | 'live' | 'committing';

/** Commit-start metadata. Captured at the moment of release so each
 *  rAF tick can compute the current progress from the elapsed time
 *  alone (no DOM read-back). */
export interface CommitStartInfo {
	/** Progress at the moment of release. */
	readonly progressStart: number;
	/** Target progress. 1 for a commit (lands on TO); 0 for a cancel
	 *  (snaps back to FROM). Read from `plan.progressDirection`. */
	readonly progressTarget: number;
	/** Release velocity in unit progress per ms (releaseVelocity_px_ms
	 *  / distance_px). Signed. */
	readonly progressVelocity: number;
	/** Commit-start timestamp (ms, caller's clock). */
	readonly t0: number;
	/** Settle duration (ms). Computed by `startCommit` from the
	 *  velocity and the remaining distance, clamped to
	 *  `[COMMIT_T_MIN_MS, COMMIT_T_MAX_MS]`, or `COMMIT_T_DEFAULT_MS`
	 *  for the near-zero / wrong-direction fallback. */
	readonly durationMs: number;
	/** Always `false` when non-null. When reduced-motion is active at
	 *  commit start, `startCommit` takes the snap path and returns
	 *  `commitStart: null`, so a non-null `CommitStartInfo` always
	 *  reflects a momentum commit. The integrator does NOT read this
	 *  field (it gates on `state.phase`); retained for diagnostics. */
	readonly reducedMotion: boolean;
}

/** The executor's full state record. The reactive shell holds this as
 *  `$state`. The orchestrator reads `progress` and `commitStart` off
 *  it. */
export interface ExecutorState {
	readonly phase: ExecutorPhase;
	/** Current gesture progress in [0, 1]. 0 = FROM visible; 1 = TO
	 *  visible. Authoritative: no consumer reads this from the DOM. */
	readonly progress: number;
	/** Live drag offset (px, signed). Streams in via `applyDrag`; the
	 *  plan's consumer functions read it each frame. */
	readonly liveOffset: number;
	/** Populated when `phase === 'committing'`; null otherwise. */
	readonly commitStart: CommitStartInfo | null;
}

/** Initial state. The SSR render and the first-load landing both start
 *  here; no animation runs until a drag-start event arrives. */
export function initialExecutorState(): ExecutorState {
	return { phase: 'idle', progress: 0, liveOffset: 0, commitStart: null };
}

// ---------------------------------------------------------------------------
// Drag (live phase).

/** Drag-update payload. The orchestrator computes `progress` from the
 *  live intent offset and the gesture distance. */
export interface DragUpdate {
	readonly progress: number;
	readonly liveOffset: number;
}

/** Apply a drag move. Sets `phase: 'live'`, updates the progress and
 *  live offset, and clears any in-flight commit metadata. Returns a
 *  fresh state record (the reactive shell's `$state` assignment
 *  notifies dependents). */
export function applyDrag(state: ExecutorState, update: DragUpdate): ExecutorState {
	return {
		phase: 'live',
		progress: update.progress,
		liveOffset: update.liveOffset,
		commitStart: null
	};
}

// ---------------------------------------------------------------------------
// Commit (velocity-matched momentum integral).

/** Input to `startCommit`. The release velocity is in px/ms (matching
 *  `IntentState.releaseVelocity`); `startCommit` normalizes to unit
 *  progress per ms using `plan.pageTrack.distance`. */
export interface CommitInput {
	/** The finger's release velocity (px/ms, signed). Positive = the
	 *  drag was moving rightward at release. */
	readonly releaseVelocityPxPerMs: number;
	/** The active plan. Its `progressDirection` selects commit (0,
	 *  lands on TO) vs cancel (1, snaps back to FROM); its
	 *  `pageTrack.distance` normalizes the velocity to progress/ms. */
	readonly plan: TransitionPlan;
	/** Whether `prefers-reduced-motion: reduce` is active. Derived
	 *  from `plan.commitPhysics` (the resolver bakes the reduced-motion
	 *  state at gesture start via `commitPhysicsFor`). */
	readonly reducedMotion: boolean;
	/** Commit-start timestamp (ms, caller's clock). */
	readonly now: number;
	/** Optional explicit duration (ms). When set, `solveCommitDuration`
	 *  skips the velocity-matched solver and uses this duration
	 *  directly. Cycle 5b1's orchestrator uses this for tab-click
	 *  exits (a discrete nav, not a finger release) so the slide
	 *  matches the 200ms duration of the non-pilot routes' CSS
	 *  `duration-200`. Untyped for gesture commits (the velocity-matched
	 *  solver runs). */
	readonly durationOverrideMs?: number;
}

/** Internal helper: clamp a value to [lo, hi]. */
function clamp(value: number, lo: number, hi: number): number {
	if (value < lo) return lo;
	if (value > hi) return hi;
	return value;
}

/** Result of `solveCommitDuration`. `durationMs` is the settle
 *  duration (clamped, or `COMMIT_T_DEFAULT_MS` for the fallback
 *  branches); `progressVelocity` is the release velocity normalized
 *  to unit progress per ms (signed); `snapped` is true when
 *  `reducedMotion` selected the snap path, in which case the caller
 *  short-circuits and does not run the integrator. */
export interface SolvedCommit {
	readonly durationMs: number;
	readonly progressVelocity: number;
	readonly snapped: boolean;
}

/** Internal helper: solve the commit duration from the release
 *  velocity and the remaining progress distance. Pure; exported for
 *  unit-test direct access. */
export function solveCommitDuration(input: CommitInput, currentProgress: number): SolvedCommit {
	if (input.reducedMotion) {
		// Reduced-motion snap: no integration. Duration is irrelevant;
		// the caller returns idle with progress = target.
		return { durationMs: 0, progressVelocity: 0, snapped: true };
	}
	// Explicit duration override (Cycle 5b1's tab-click path): skip the
	// velocity-matched solver and use the supplied duration directly.
	// The integrator's `progressVelocity` is unused when the caller
	// supplies a duration; pass through the velocity-derived value for
	// diagnostic continuity only.
	const distancePx = Math.max(Math.abs(input.plan.pageTrack.distance), 1);
	const clampedVelPx = clamp(
		input.releaseVelocityPxPerMs,
		-COMMIT_VELOCITY_CLAMP_PX_PER_MS,
		COMMIT_VELOCITY_CLAMP_PX_PER_MS
	);
	const progressVelocity = clampedVelPx / distancePx;
	if (input.durationOverrideMs !== undefined) {
		return {
			durationMs: input.durationOverrideMs,
			progressVelocity,
			snapped: false
		};
	}
	const target = input.plan.progressDirection === 0 ? 1 : 0;
	const deltaProgress = Math.abs(target - currentProgress);
	const directionSign = Math.sign(target - currentProgress);

	// Near-zero release velocity: fall back to the default ease.
	if (Math.abs(clampedVelPx) < COMMIT_VELOCITY_EPSILON_PX_PER_MS) {
		return { durationMs: COMMIT_T_DEFAULT_MS, progressVelocity, snapped: false };
	}
	// Velocity pointing away from target (e.g. user reversed then
	// released), OR the progress is already at the target
	// (`directionSign === 0`, i.e. `deltaProgress === 0`): the
	// constant-deceleration integral is not shaped for backward motion,
	// and an already-at-target progress has no distance to integrate.
	// Fall back to the default ease so the settle still plays smoothly
	// (T_DEFAULT, not the solve's T_MIN clamp). The `<=` (not `<`) is
	// load-bearing: it routes the already-at-target case to T_DEFAULT.
	// Plan-agnostic: fires for either direction.
	if (directionSign * progressVelocity <= 0) {
		return { durationMs: COMMIT_T_DEFAULT_MS, progressVelocity, snapped: false };
	}
	// Constant-deceleration match: T = 2 * |Δprogress| / |progressVel|.
	// The ease `s(u) = 2u - u²` has s'(0) = 2, so the initial slope in
	// t-space is `2 * Δprogress / T = progressVel` (the release
	// velocity), satisfying the velocity-match.
	const computed = (2 * deltaProgress) / Math.abs(progressVelocity);
	return {
		durationMs: clamp(computed, COMMIT_T_MIN_MS, COMMIT_T_MAX_MS),
		progressVelocity,
		snapped: false
	};
}

/** Begin a commit. Computes the commit-start metadata (or snaps for
 *  reduced motion) and returns the next state. Pure; the reactive
 *  shell's `onCommit` boundary method calls this and then publishes
 *  the resulting visual (built from the state) via the driver.
 *
 *  For reduced motion: returns `{ phase: 'idle', progress: target,
 *  commitStart: null }`. The shell publishes once and does NOT
 *  schedule the rAF.
 *
 *  Otherwise: returns `{ phase: 'committing', progress: currentProgress,
 *  commitStart: {...} }` and the rAF tick samples `sampleFrame` until
 *  `done`. */
export function startCommit(state: ExecutorState, input: CommitInput): ExecutorState {
	const target = input.plan.progressDirection === 0 ? 1 : 0;
	const solved = solveCommitDuration(input, state.progress);
	if (solved.snapped) {
		return {
			phase: 'idle',
			progress: target,
			liveOffset: state.liveOffset,
			commitStart: null
		};
	}
	const commitStart: CommitStartInfo = {
		progressStart: state.progress,
		progressTarget: target,
		progressVelocity: solved.progressVelocity,
		t0: input.now,
		durationMs: solved.durationMs,
		reducedMotion: false
	};
	return {
		phase: 'committing',
		progress: state.progress,
		liveOffset: state.liveOffset,
		commitStart
	};
}

// ---------------------------------------------------------------------------
// Per-frame sampling.

/** Result of one `sampleFrame` call. */
export interface FrameSample {
	/** The next state record (the reactive shell assigns this to its
	 *  `$state` so dependents re-run). */
	readonly state: ExecutorState;
	/** Whether the commit has settled. When true the shell stops
	 *  rescheduling the rAF. The shell does NOT emit `onLand` itself;
	 *  the orchestrator observes `done` and emits the
	 *  post-commit land. */
	readonly done: boolean;
}

/** Sample one commit frame at the given time. Pure: returns the next
 *  state and a `done` flag; does NOT touch the driver. The reactive
 *  shell calls `publishFrame` (below) to write the visual through the
 *  driver.
 *
 *  Outside the committing phase this is a no-op: it returns the
 *  unchanged state with `done: true` so the shell stops the rAF. */
export function sampleFrame(state: ExecutorState, plan: TransitionPlan, now: number): FrameSample {
	if (state.phase !== 'committing' || !state.commitStart) {
		return { state, done: true };
	}
	const cs = state.commitStart;
	const elapsed = now - cs.t0;
	const u = clamp(elapsed / cs.durationMs, 0, 1);
	// Constant-deceleration ease: s(u) = 2u - u². s(0)=0, s(1)=1,
	// s'(0)=2 (initial slope matched to release velocity via the
	// duration solver), s'(1)=0 (settles at zero velocity). Symmetric
	// in shape for commit (target=1) and cancel (target=0): the
	// progress is interpolated from start to target by the eased
	// fraction.
	const eased = 2 * u - u * u;
	const newProgress = cs.progressStart + (cs.progressTarget - cs.progressStart) * eased;
	const nextState: ExecutorState = {
		phase: 'committing',
		progress: newProgress,
		liveOffset: state.liveOffset,
		commitStart: cs
	};
	return { state: nextState, done: u >= 1 };
}

// ---------------------------------------------------------------------------
// Visual building.

/** The absolute page-track translateX for `plan` at `progress`. Pure.
 *  Single source of truth for the track geometry: `buildVisual` and the
 *  interrupt-handoff helper (`progressAtTranslateX`) both route through
 *  here, so the visual the driver writes and the position the next
 *  transition starts from can never drift apart.
 *
 *  progress=0 leaves FROM centred at `restingTranslate` (default 0);
 *  progress=1 brings TO centred at `restingTranslate + sign * distance`.
 *  axis='left' translates leftward (negative) as progress advances;
 *  axis='right' translates rightward (positive). The sign convention
 *  matches `PageTrackAxis` in `nav-resolvers.ts` ('left' = neighbour
 *  from the right enters = track moves left). */
export function trackTranslateX(plan: TransitionPlan, progress: number): number {
	const sign = plan.pageTrack.axis === 'left' ? -1 : 1;
	const base = plan.pageTrack.restingTranslate ?? 0;
	return base + sign * plan.pageTrack.distance * progress;
}

/** Inverse of `trackTranslateX`: the progress in `plan` whose visual
 *  position equals `tx`. Used to start a new transition from the
 *  track's CURRENT visual position when one transition interrupts
 *  another (a gesture or tab-click landing mid-enter, a tab-click
 *  landing mid-commit). The handoff is geometry-driven: read the
 *  running plan's current translateX via `trackTranslateX`, then invert
 *  into the new plan's progress here. The "which animation is running"
 *  information is the running plan's geometry (base / sign / distance),
 *  read together with the executor's current progress.
 *
 *  Returns 0 when the plan covers zero distance (a degenerate plan with
 *  no slide). Clamps to [0, 1] when `tx` falls outside the plan's
 *  travelled span. */
export function progressAtTranslateX(plan: TransitionPlan, tx: number): number {
	const sign = plan.pageTrack.axis === 'left' ? -1 : 1;
	const base = plan.pageTrack.restingTranslate ?? 0;
	const span = sign * plan.pageTrack.distance;
	if (span === 0) return 0;
	return clamp((tx - base) / span, 0, 1);
}

/** Build the per-frame visual record by calling the plan's consumer
 *  functions. Pure: returns the visual; the reactive shell hands it to
 *  the driver. */
export function buildVisual(
	plan: TransitionPlan,
	progress: number,
	liveOffset: number
): NavVisualWrite {
	const fab = plan.fab(progress, liveOffset);
	const header = plan.header(progress, liveOffset);
	const translateX = trackTranslateX(plan, progress);
	return {
		pageTrack: { translateX },
		fab: { scale: fab.scale, translateY: fab.translateY, visible: fab.visible },
		header: {
			morph: header.morph,
			titleCrossfade: header.titleCrossfade,
			translateY: header.translateY
		}
	};
}

/** Publish the current state's visual through the driver. Impure via
 *  the driver; pure with respect to the executor (no internal state
 *  mutation). Convenience: the reactive shell calls this in its
 *  `#publish` private method; exposing it here lets the unit suite
 *  drive the publish explicitly. */
export function publishFrame(
	state: ExecutorState,
	plan: TransitionPlan,
	driver: NavDomDriver
): void {
	const visual = buildVisual(plan, state.progress, state.liveOffset);
	driver.write(visual);
}

/** Convenience: sample one commit frame AND publish its visual through
 *  the driver in one call. The unit suite uses this for its single-step
 *  assertion; the multi-step sequence tests call `sampleFrame` in a
 *  loop rather than this convenience. Returns the same `FrameSample`
 *  that `sampleFrame` returns. */
export function tickFrame(
	state: ExecutorState,
	plan: TransitionPlan,
	now: number,
	driver: NavDomDriver
): FrameSample {
	const sample = sampleFrame(state, plan, now);
	publishFrame(sample.state, plan, driver);
	return sample;
}

/** Whether the shell should schedule a rAF. Pure (testable under
 *  `bun:test`): false in SSR (no `requestAnimationFrame` available) and
 *  false when a rAF is already in flight (single-flight). The shell's
 *  `#ensureRaf` calls this so the SSR + single-flight gate has unit
 *  coverage even though the rAF scheduling itself lives in the
 *  reactive shell. */
export function shouldScheduleRaf(isBrowser: boolean, rafInFlight: boolean): boolean {
	return isBrowser && !rafInFlight;
}
