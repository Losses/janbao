// src/lib/utils/nav-executor-logic.ts
/**
 * Pure (runes-free) half of the Layer 5 executor. The reactive shell
 * `nav-executor.svelte.ts` owns the rAF loop and the `$state` record;
 * it delegates every per-frame decision to this module so the
 * integrator + per-frame math run under `bun:test` with no Svelte
 * runes loader (mirroring the Cycle 2/3 split -
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
 * In Cycle 4 shadow mode this module is exercised by its own unit
 * suite (`nav-executor-logic.test.ts`) using a `MockNavDomDriver`.
 * The reactive shell wires the rAF loop; Cycle 5 connects the
 * orchestrator's phase events to the shell's boundary methods.
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

/** The executor's local phase. A strict subset of the orchestrator's
 *  sub-phases in `nav-state-machine-logic.ts`:
 *  - `'idle'`: no transition in flight OR reduced-motion snap OR
 *    post-interrupt handoff point.
 *  - `'live'`: the drag is live; each pointermove publishes directly.
 *  - `'committing'`: the commit rAF loop is integrating.
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
	/** Always `false` in Cycle 4. When reduced-motion is active at
	 *  commit start, `startCommit` takes the snap path and returns
	 *  `commitStart: null`, so a non-null `CommitStartInfo` always
	 *  reflects a momentum commit. The integrator does NOT read this
	 *  field (it gates on `state.phase`); retained as a placeholder
	 *  for a possible Cycle-5 diagnostic consumer. */
	readonly reducedMotion: boolean;
}

/** The executor's full state record. The reactive shell holds this as
 *  `$state`; the orchestrator and consumers read fields off it. */
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
 *  here; no animation runs until a drag-start event arrives (Cycle 5
 *  wiring). */
export function initialExecutorState(): ExecutorState {
	return { phase: 'idle', progress: 0, liveOffset: 0, commitStart: null };
}

// ---------------------------------------------------------------------------
// Drag (live phase).

/** Drag-update payload. The orchestrator (Cycle 5 wiring) computes
 *  `progress` from the live intent offset and the gesture distance. */
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
	/** Whether `prefers-reduced-motion: reduce` is active. The
	 *  reactive shell reads this from the driver and passes it here. */
	readonly reducedMotion: boolean;
	/** Commit-start timestamp (ms, caller's clock). */
	readonly now: number;
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
	const distancePx = Math.max(Math.abs(input.plan.pageTrack.distance), 1);
	const clampedVelPx = clamp(
		input.releaseVelocityPxPerMs,
		-COMMIT_VELOCITY_CLAMP_PX_PER_MS,
		COMMIT_VELOCITY_CLAMP_PX_PER_MS
	);
	const progressVelocity = clampedVelPx / distancePx;
	const target = input.plan.progressDirection === 0 ? 1 : 0;
	const deltaProgress = Math.abs(target - currentProgress);
	const directionSign = Math.sign(target - currentProgress);

	// Near-zero release velocity: fall back to the default ease.
	if (Math.abs(clampedVelPx) < COMMIT_VELOCITY_EPSILON_PX_PER_MS) {
		return { durationMs: COMMIT_T_DEFAULT_MS, progressVelocity, snapped: false };
	}
	// Velocity pointing away from target (e.g. user reversed then
	// released): the constant-deceleration integral is not shaped for
	// backward motion. Fall back to the default ease so the cancel
	// still settles smoothly.
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
// Interruption.

/** Interrupt the in-flight commit. Per §5: a new intent arriving
 *  mid-commit cancels the rAF and hands off from the current visual
 *  state. The current `progress` IS the handoff point (no DOM
 *  read-back); the next `applyDrag` from the orchestrator continues
 *  from here.
 *
 *  Returns a state record with `phase: 'idle'`, the current progress
 *  preserved, and `commitStart: null`. The reactive shell stops the
 *  rAF; the next drag-start event re-enters the live phase. */
export function interrupt(state: ExecutorState): ExecutorState {
	if (state.phase !== 'committing') return state;
	return {
		phase: 'idle',
		progress: state.progress,
		liveOffset: state.liveOffset,
		commitStart: null
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
	 *  the Cycle-5 orchestrator observes `done` and emits the
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

/** Build the per-frame visual record by calling the plan's consumer
 *  functions. Pure: returns the visual; the reactive shell hands it to
 *  the driver.
 *
 *  The page-track translate: progress=0 leaves FROM centred
 *  (translateX = 0); progress=1 brings TO centred. For axis='left'
 *  the track translates leftward (negative translateX) as progress
 *  advances; for axis='right' it translates rightward (positive). The
 *  sign convention matches `PageTrackAxis` in `nav-resolvers.ts`
 *  ('left' = neighbour from the right enters = track moves left). */
export function buildVisual(
	plan: TransitionPlan,
	progress: number,
	liveOffset: number
): NavVisualWrite {
	const fab = plan.fab(progress, liveOffset);
	const header = plan.header(progress, liveOffset);
	const sign = plan.pageTrack.axis === 'left' ? -1 : 1;
	const translateX = sign * plan.pageTrack.distance * progress;
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
