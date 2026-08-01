// src/lib/utils/nav-executor-logic.ts
/**
 * Pure (runes-free) half of the Layer 5 executor. The reactive shell
 * `nav-executor.svelte.ts` owns the rAF loop and the `$state` record;
 * it delegates every per-frame decision to this module so the
 * integrator + per-frame math run under `bun:test` with no Svelte
 * runes loader (mirroring the pure-logic / reactive-shell split -
 * `bun-test-no-runes-loader` memory).
 *
 * Per `docs/DV20-Plan.md` §5 + the C05b2 spec: a single rAF loop driven
 * by the orchestrator's phase writes the per-frame visual for the page
 * track through an injected `NavDomDriver`. The FAB and Header are NOT
 * written by this loop; they are reactive readers of the orchestrator's
 * publication (`fabScale(progress, ...)` and the Header's `$derived`
 * reads). The driver interface is page-track-only (no FAB or Header write
 * surface); `write()` applies the page-track transform when the element is
 * bound. The commit
 * phase uses a velocity-matched momentum
 * integral (variable duration), NOT a hardcoded ease. Reduced-motion
 * snaps. Interruption cancels the commit and hands off from the
 * current visual state with no jump. The executor publishes
 * authoritative state; there is no DOM read-back (§13.5).
 *
 * This module is exercised by its own unit suite
 * (`nav-executor-logic.test.ts`) using a `MockNavDomDriver`. The
 * reactive shell wires the rAF loop; the orchestrator connects its
 * phase events to the shell's boundary methods.
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
 *  - `'live'`: the drag is live (orchestrator sub `dragging`); each
 *    pointermove publishes directly.
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
	/** Populated when `phase === 'committing'`; null otherwise. */
	readonly commitStart: CommitStartInfo | null;
}

/** Initial state. The SSR render and the first-load landing both start
 *  here; no animation runs until a drag-start event arrives. */
export function initialExecutorState(): ExecutorState {
	return { phase: 'idle', progress: 0, commitStart: null };
}

// ---------------------------------------------------------------------------
// Drag (live phase).

/** Drag-update payload. The orchestrator computes `progress` from the
 *  live intent offset and the gesture distance. */
export interface DragUpdate {
	readonly progress: number;
}

/** Apply a drag move. Sets `phase: 'live'`, updates the progress, and
 *  clears any in-flight commit metadata. Returns a fresh state record
 *  (the reactive shell's `$state` assignment notifies dependents). */
export function applyDrag(_state: ExecutorState, update: DragUpdate): ExecutorState {
	return {
		phase: 'live',
		progress: update.progress,
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
	 *  directly. The orchestrator sets it only for an accelerated
	 *  in-flight commit (`#accelerateInFlight`), shortening the remainder
	 *  of a commit a discrete navigation interrupted. Undefined for
	 *  gesture commits, tab-click / forward-enter commits, and
	 *  `playEnterAnimation` (the velocity-matched solver runs). */
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
 *  branches); `progressVelocity` is the release velocity normalized to
 *  unit progress per ms, axis-adjusted so a positive value means progress
 *  is advancing toward the commit target; `snapped` is true when
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
	// Explicit duration override: skip the velocity-matched solver and
	// use the supplied duration directly. The orchestrator's
	// `#accelerateInFlight` is the only caller that supplies this
	// (shortening an in-flight commit so a queued discrete navigation
	// can replay sooner). The integrator's `progressVelocity` is unused
	// when the caller supplies a duration; pass through the
	// velocity-derived value for diagnostic continuity only.
	const distancePx = Math.max(Math.abs(input.plan.pageTrack.distance), 1);
	const clampedVelPx = clamp(
		input.releaseVelocityPxPerMs,
		-COMMIT_VELOCITY_CLAMP_PX_PER_MS,
		COMMIT_VELOCITY_CLAMP_PX_PER_MS
	);
	// Normalize the screen-space release velocity to progress-space. The track
	// follows the finger, and `trackTranslateX` advances leftward (negative) as
	// progress increases for `axis='left'`, rightward (positive) for `'right'`,
	// so a leftward (negative) release is progress-positive on `axis='left'`.
	// Without this sign the gate below mis-fires for `axis='left'` commits
	// (forward tab swipes) and routes them to T_DEFAULT instead of the
	// velocity-matched solve.
	const axisSign = input.plan.pageTrack.axis === 'left' ? -1 : 1;
	const progressVelocity = (clampedVelPx * axisSign) / distancePx;
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
	// Already at the target (e.g. a tab-click whose startProgress equals
	// the commit target because the track was already at the target
	// visual - a tab-click landing at a forward-enter's first frame). No
	// slide to play; settle immediately so the nav is not delayed by a
	// no-op commit rAF.
	if (state.progress === target) {
		return {
			phase: 'idle',
			progress: target,
			commitStart: null
		};
	}
	const solved = solveCommitDuration(input, state.progress);
	if (solved.snapped) {
		return {
			phase: 'idle',
			progress: target,
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

/** The constant-deceleration easing curve used by the executor's commit
 *  loop (`sampleFrame` below), the orchestrator's settle ease rAF, and
 *  the orchestrator's tap-scrub ease rAF. s(0) = 0, s(1) = 1, s'(0) = 2
 *  (initial slope matched to release velocity via the duration solver),
 *  s'(1) = 0 (settles at zero velocity). Exposed as a named function so
 *  all three rAF channels share one curve definition and the unit suite
 *  can verify the shape directly: `sampleFrame` applies the per-tick
 *  clamp on top of this curve, so a single call with a large `elapsed`
 *  returns the clamped value (startProgress + cap), not the eased
 *  value. A curve-shape test queries `commitEase(u)` itself. */
export function commitEase(u: number): number {
	return 2 * u - u * u;
}

/** The nominal frame period (ms) used to size the per-tick progress
 *  clamp for the settle ease. 16.7ms = one frame at 60fps, the
 *  project's nominal refresh rate. The clamp never engages on a tick
 *  whose elapsed-time delta is at or below this period (i.e. a normal
 *  60fps frame); under main-thread load a single rAF tick can be
 *  delayed by many frame periods, and the per-tick clamp caps the
 *  progress advance so the animation does not pop on its first
 *  post-block frame. */
export const SETTLE_NOMINAL_FRAME_MS = 16.7;

/** Multiplier on the steepest possible normal-frame advance. The
 *  constant-deceleration curve `commitEase(u) = 2u - u²` has s'(0) = 2,
 *  so the steepest first-frame advance is `2 * (frameMs / durationMs) *
 *  span`. A multiplier of 1.25 gives 25% headroom over this steepest
 *  case, so the clamp never engages on a true 60fps frame even for the
 *  shortest commit duration (`COMMIT_T_MIN_MS = 100ms`, span 1.0 → cap
 *  ≈ 0.418 vs normal first-frame delta ≈ 0.334). Under load the cap
 *  limits each tick to this multiple of the steepest normal frame, so a
 *  delayed first tick degrades gracefully (slower wall-clock finish)
 *  without popping.
 *
 *  For a velocity=0 commit (~300ms duration, span ~0.7): the cap is
 *  ~0.097 per tick on the raw-scale `settleProgress`, bounding the
 *  title-span crossfade (the page-track reads the executor's
 *  `publication.progress`, not `settleProgress`). The FAB scale does NOT
 *  read `settleProgress` during a settle (branch 3 lerps off
 *  `settleMorphFraction`; branch 5 reads `publication.progress`), so
 *  this settleProgress cap does not bound the FAB; the e2e FAB leap-guard
 *  (`< 0.2`) and `MIN_INTERMEDIATES` hold under `commitEase`'s normal
 *  per-frame advance, not under this cap. The 1.25 factor preserves the
 *  60fps tolerance (1.20 would clamp frames slower than ~20ms). */
export const SETTLE_PER_TICK_CLAMP_FACTOR = 1.25;

/** The maximum per-tick progress advance for an ease of the given
 *  duration and span. The cap is the constant-deceleration curve's
 *  steepest normal-frame advance (`2 * (16.7ms / durationMs) * span`,
 *  i.e. `s'(0)` times the frame-period fraction of the duration times
 *  the progress span) multiplied by `SETTLE_PER_TICK_CLAMP_FACTOR`.
 *  Pure; exported so the orchestrator's settle ease rAF and tap-scrub
 *  rAF reuse the same cap as the executor's commit rAF: one source of
 *  truth for the per-tick clamp policy across every animation channel
 *  that uses `commitEase`. */
export function settlePerTickCap(durationMs: number, span: number): number {
	if (durationMs <= 0) return Math.abs(span);
	return SETTLE_PER_TICK_CLAMP_FACTOR * 2 * (SETTLE_NOMINAL_FRAME_MS / durationMs) * Math.abs(span);
}

/** Sample one commit frame at the given time. Pure: returns the next
 *  state and a `done` flag; does NOT touch the driver. The reactive
 *  shell calls `publishFrame` (below) to write the visual through the
 *  driver.
 *
 *  Per-tick progress clamp: the desired progress for this tick is
 *  computed from the elapsed-time ease `commitEase(elapsed /
 *  durationMs)`; the per-tick advance (`desired - state.progress`) is
 *  then clamped to `settlePerTickCap(durationMs, |target - start|)`.
 *  The cap is sized so a normal 60fps frame's advance is well within
 *  it: the clamp never engages on a 60fps frame, so normal-condition
 *  timing and the easing-curve shape come from `commitEase` alone. The
 *  clamp exists for the loaded-main-thread case where the first
 *  post-commit rAF tick is delayed by many frame periods: the
 *  elapsed-time delta for that tick corresponds to many frames of
 *  advance, and clamping caps the single-tick progress delta so the
 *  page-track (driven by `publication.progress` via `publishFrame`) and
 *  the branch-5 FAB (`publication.progress` when `enterFabAnchor` is
 *  null; branch 3 reads the unclamped `settleMorphFraction` and is not
 *  bounded by this cap) ease smoothly
 *  instead of popping. The rAF reschedules a few extra ticks to close
 *  the remaining gap, so a delayed first tick extends the wall-clock
 *  duration but never pops.
 *
 *  `done` is `u >= 1 && progress === target`: the rAF keeps
 *  rescheduling until BOTH the elapsed-time ease has reached u=1 AND
 *  the clamped progress has caught up to the target. Without the
 *  second condition the rAF would terminate at u=1 even if the clamped
 *  progress had not caught up; with it the rAF reschedules a few extra
 *  ticks to close the remaining gap.
 *
 *  Outside the committing phase this is a no-op: it returns the
 *  unchanged state with `done: true` so the shell stops the rAF. */
export function sampleFrame(state: ExecutorState, _plan: TransitionPlan, now: number): FrameSample {
	if (state.phase !== 'committing' || !state.commitStart) {
		return { state, done: true };
	}
	const cs = state.commitStart;
	const elapsed = now - cs.t0;
	const u = clamp(elapsed / cs.durationMs, 0, 1);
	const eased = commitEase(u);
	const desiredProgress = cs.progressStart + (cs.progressTarget - cs.progressStart) * eased;
	// Clamp the per-tick advance so a delayed first rAF tick (main
	// thread blocked under load) cannot advance progress by more than
	// a smooth amount in a single tick. `settlePerTickCap` sizes the
	// cap from the commit's duration and span so it never engages on a
	// normal 60fps frame. The clamp is symmetric (the cancel direction
	// advances progress downward); the absolute cap value is the same
	// for both directions because the constant-deceleration curve is
	// symmetric in shape for commit (target=1) and cancel (target=0).
	const span = Math.abs(cs.progressTarget - cs.progressStart);
	const cap = settlePerTickCap(cs.durationMs, span);
	const delta = desiredProgress - state.progress;
	const clampedDelta = clamp(delta, -cap, cap);
	const newProgress = state.progress + clampedDelta;
	// `done` requires BOTH the elapsed-time ease to have reached u=1
	// AND the clamped progress to have caught up to the target. The
	// clamp can lag the elapsed-time curve (it bounds the per-tick
	// delta, not the elapsed-time computation), so without the second
	// condition the rAF would terminate at u=1 even if the clamped
	// progress had not caught up; with it the rAF reschedules a few
	// extra ticks to close the remaining gap.
	const atTarget = Math.abs(cs.progressTarget - newProgress) < 1e-6;
	const done = u >= 1 && atTarget;
	const nextState: ExecutorState = {
		phase: 'committing',
		progress: newProgress,
		commitStart: cs
	};
	return { state: nextState, done };
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
 *  no slide). Extrapolates (returns a value outside [0, 1]) when `tx`
 *  falls outside the new plan's travelled span, so the new transition's
 *  first frame reproduces the current visual exactly (§5 "No jump"). A
 *  direction-reversing re-grab on the bidirectional tab host builds a
 *  plan whose span does not contain the in-flight visual (a forward
 *  commit toward tab N interrupted by a backward re-grab whose plan
 *  spans the previous tab); extrapolating keeps the track continuous
 *  while the drag proceeds. Out-of-range progress is safe downstream:
 *  `trackTranslateX` is linear, the commit solver scales by
 *  `|target - progress|`, and the raw progress the FAB reads
 *  (`publication.progress`) and the Header reads via `pager.backMorph`
 *  is clamped at its own publish site (the orchestrator), so only
 *  the track translateX carries the out-of-range value transiently. */
export function progressAtTranslateX(plan: TransitionPlan, tx: number): number {
	const sign = plan.pageTrack.axis === 'left' ? -1 : 1;
	const base = plan.pageTrack.restingTranslate ?? 0;
	const span = sign * plan.pageTrack.distance;
	if (span === 0) return 0;
	return (tx - base) / span;
}

/** Build the per-frame visual record. Pure: returns the visual; the
 *  reactive shell hands it to the driver. Carries only the page-track
 *  translate; the FAB and Header are reactive readers the executor
 *  does not write through the driver. */
export function buildVisual(plan: TransitionPlan, progress: number): NavVisualWrite {
	const translateX = trackTranslateX(plan, progress);
	return {
		pageTrack: { translateX }
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
	const visual = buildVisual(plan, state.progress);
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
