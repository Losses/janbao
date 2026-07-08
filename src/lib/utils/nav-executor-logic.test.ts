// src/lib/utils/nav-executor-logic.test.ts
/**
 * Unit suite for the Layer 5 executor pure half
 * (`nav-executor-logic.ts`). Runs under `bun:test` with no Svelte
 * runes loader; the rAF loop in the reactive shell
 * (`nav-executor.svelte.ts`) is exercised in Cycle 5.
 *
 * Coverage focus (per the C04 spec deliverables):
 *   - The build-visual function: pageTrack.axis sign convention,
 *     FAB/Header pass-through.
 *   - applyDrag updates progress and liveOffset.
 *   - Velocity-to-duration mapping (slow release > fast release; near-
 *     zero fallback; high-velocity clamp; wrong-direction fallback).
 *   - Reduced-motion snap (no integration; progress jumps to target).
 *   - Per-frame commit sample sequence (start, mid, end; monotonic;
 *     settle to target).
 *   - SSR + single-flight gate (`shouldScheduleRaf`): false in SSR and
 *     when a rAF is already in flight.
 *   - idle no-ops: sampleFrame on idle state is a no-op;
 *     initialExecutorState is idle.
 */

import { describe, test, expect } from 'bun:test';
import {
	COMMIT_T_DEFAULT_MS,
	COMMIT_T_MAX_MS,
	COMMIT_T_MIN_MS,
	COMMIT_VELOCITY_CLAMP_PX_PER_MS,
	COMMIT_VELOCITY_EPSILON_PX_PER_MS,
	applyDrag,
	buildVisual,
	initialExecutorState,
	progressAtTranslateX,
	publishFrame,
	sampleFrame,
	shouldScheduleRaf,
	solveCommitDuration,
	startCommit,
	tickFrame,
	trackTranslateX,
	type CommitInput,
	type ExecutorState
} from './nav-executor-logic';
import { MockNavDomDriver } from './nav-dom-driver';
import type { TransitionPlan } from './nav-resolvers';

// ---------------------------------------------------------------------------
// Plan fixtures. The plan's consumer functions are pure; the suite
// builds minimal stubs that record the (progress, liveOffset) the
// executor passed in so the per-frame call sequence is assertable.

interface PlanStubOptions {
	axis: 'left' | 'right';
	distance: number;
	progressDirection: 0 | 1;
}

/** Recorded (progress, liveOffset) the plan's consumer functions were
 *  called with. Used by the suite to assert the per-frame call
 *  sequence. */
interface PlanCallRecord {
	progress: number;
	liveOffset: number;
}

/** A plan stub plus the call-record arrays its consumer functions
 *  append to. The suite reads `fabCalls` / `headerCalls` to verify the
 *  executor passed the expected (progress, liveOffset) each frame. */
interface RecordedPlan extends TransitionPlan {
	readonly fabCalls: PlanCallRecord[];
	readonly headerCalls: PlanCallRecord[];
}

function planStub(opts: PlanStubOptions): RecordedPlan {
	const fabCalls: PlanCallRecord[] = [];
	const headerCalls: PlanCallRecord[] = [];
	return {
		pageTrack: { axis: opts.axis, distance: opts.distance },
		fab: (progress, liveOffset) => {
			fabCalls.push({ progress, liveOffset });
			return { scale: 1 - progress, translateY: 0, visible: progress < 0.5 };
		},
		header: (progress, liveOffset) => {
			headerCalls.push({ progress, liveOffset });
			return { morph: progress, titleCrossfade: progress, translateY: 0 };
		},
		progressDirection: opts.progressDirection,
		commitPhysics: 'momentum',
		fabCalls,
		headerCalls
	};
}

// A neutral input for `startCommit` callers; the suite overrides
// individual fields per test.
function baseCommitInput(overrides: Partial<CommitInput> = {}): CommitInput {
	return {
		releaseVelocityPxPerMs: 1,
		plan: planStub({ axis: 'left', distance: 375, progressDirection: 0 }),
		reducedMotion: false,
		now: 1000,
		...overrides
	};
}

// ---------------------------------------------------------------------------
// buildVisual.

describe('buildVisual', () => {
	test('axis left: progress 0 leaves FROM centred (translateX = 0)', () => {
		const plan = planStub({ axis: 'left', distance: 375, progressDirection: 0 });
		const visual = buildVisual(plan, 0, 0);
		// toBeCloseTo accepts both +0 and -0 (sign * distance * 0 produces -0
		// for axis 'left'); CSS renders them identically.
		expect(visual.pageTrack.translateX).toBeCloseTo(0, 7);
	});

	test('axis left: progress 0.5 translates the track leftward by half distance', () => {
		const plan = planStub({ axis: 'left', distance: 375, progressDirection: 0 });
		const visual = buildVisual(plan, 0.5, 0);
		expect(visual.pageTrack.translateX).toBe(-187.5);
	});

	test('axis left: progress 1 translates the track leftward by full distance', () => {
		const plan = planStub({ axis: 'left', distance: 375, progressDirection: 0 });
		const visual = buildVisual(plan, 1, 0);
		expect(visual.pageTrack.translateX).toBe(-375);
	});

	test('axis right: progress 0.5 translates the track rightward by half distance', () => {
		const plan = planStub({ axis: 'right', distance: 375, progressDirection: 0 });
		const visual = buildVisual(plan, 0.5, 0);
		expect(visual.pageTrack.translateX).toBe(187.5);
	});

	test('axis right: progress 1 translates the track rightward by full distance', () => {
		const plan = planStub({ axis: 'right', distance: 375, progressDirection: 0 });
		const visual = buildVisual(plan, 1, 0);
		expect(visual.pageTrack.translateX).toBe(375);
	});

	test('FAB and Header visuals are passed through unchanged from the plan functions', () => {
		const plan = planStub({ axis: 'left', distance: 375, progressDirection: 0 });
		const visual = buildVisual(plan, 0.3, 12);
		expect(visual.fab.scale).toBe(0.7);
		expect(visual.fab.visible).toBe(true);
		expect(visual.header.morph).toBe(0.3);
		expect(visual.header.titleCrossfade).toBe(0.3);
		// The plan recorded the (progress, liveOffset) it was called with.
		expect(plan.fabCalls[0]).toEqual({ progress: 0.3, liveOffset: 12 });
		expect(plan.headerCalls[0]).toEqual({ progress: 0.3, liveOffset: 12 });
	});
});

// ---------------------------------------------------------------------------
// applyDrag + initialExecutorState.

describe('initialExecutorState + applyDrag', () => {
	test('initial state is idle with progress 0 and no commit metadata', () => {
		const state = initialExecutorState();
		expect(state.phase).toBe('idle');
		expect(state.progress).toBe(0);
		expect(state.liveOffset).toBe(0);
		expect(state.commitStart).toBeNull();
	});

	test('applyDrag sets phase live, updates progress and liveOffset, clears commitStart', () => {
		const committing: ExecutorState = {
			phase: 'committing',
			progress: 0.4,
			liveOffset: 50,
			commitStart: {
				progressStart: 0,
				progressTarget: 1,
				progressVelocity: 0.01,
				t0: 0,
				durationMs: 200,
				reducedMotion: false
			}
		};
		const next = applyDrag(committing, { progress: 0.6, liveOffset: 120 });
		expect(next.phase).toBe('live');
		expect(next.progress).toBe(0.6);
		expect(next.liveOffset).toBe(120);
		expect(next.commitStart).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// solveCommitDuration: velocity-to-duration mapping.

describe('solveCommitDuration: velocity-to-duration mapping', () => {
	test('reduced motion selects the snap path (snapped = true)', () => {
		const input = baseCommitInput({ reducedMotion: true });
		const result = solveCommitDuration(input, 0);
		expect(result.snapped).toBe(true);
		expect(result.durationMs).toBe(0);
	});

	test('near-zero release velocity falls back to COMMIT_T_DEFAULT_MS', () => {
		const input = baseCommitInput({
			releaseVelocityPxPerMs: COMMIT_VELOCITY_EPSILON_PX_PER_MS / 2
		});
		const result = solveCommitDuration(input, 0);
		expect(result.snapped).toBe(false);
		expect(result.durationMs).toBe(COMMIT_T_DEFAULT_MS);
	});

	test('fast release produces a shorter duration than slow release', () => {
		const distance = 375;
		const fast = solveCommitDuration(baseCommitInput({ releaseVelocityPxPerMs: 4 }), 0);
		const slow = solveCommitDuration(baseCommitInput({ releaseVelocityPxPerMs: 0.2 }), 0);
		// Same distance, different |velocity|: fast < slow.
		expect(fast.durationMs).toBeLessThan(slow.durationMs);
		expect(fast.durationMs).toBeGreaterThanOrEqual(COMMIT_T_MIN_MS);
		expect(slow.durationMs).toBeLessThanOrEqual(COMMIT_T_MAX_MS);
		// Sanity: the formula is T = 2 * 1 / (v / distance) = 2*distance/v.
		// For v=4, distance=375: T = 750/4 = 187.5ms.
		expect(fast.durationMs).toBeCloseTo((2 * distance) / 4, 5);
		// For v=0.2, distance=375: T = 750/0.2 = 3750ms, clamped to T_MAX.
		expect(slow.durationMs).toBe(COMMIT_T_MAX_MS);
	});

	test('velocity above the clamp is clamped before the duration solve', () => {
		// Above the clamp, the duration solve sees COMMIT_VELOCITY_CLAMP_PX_PER_MS.
		const distance = 375;
		const clamped = solveCommitDuration(
			baseCommitInput({ releaseVelocityPxPerMs: COMMIT_VELOCITY_CLAMP_PX_PER_MS }),
			0
		);
		const above = solveCommitDuration(
			baseCommitInput({ releaseVelocityPxPerMs: COMMIT_VELOCITY_CLAMP_PX_PER_MS * 10 }),
			0
		);
		expect(above.durationMs).toBe(clamped.durationMs);
		// Sanity: clamped velocity gives T = 2*375/5 = 150ms.
		expect(above.durationMs).toBeCloseTo((2 * distance) / COMMIT_VELOCITY_CLAMP_PX_PER_MS, 5);
	});

	test('velocity below the min-duration clamp floors at COMMIT_T_MIN_MS', () => {
		// Very high velocity with small distance would yield T < T_MIN.
		const result = solveCommitDuration(
			baseCommitInput({
				releaseVelocityPxPerMs: COMMIT_VELOCITY_CLAMP_PX_PER_MS,
				plan: planStub({ axis: 'left', distance: 50, progressDirection: 0 })
			}),
			0
		);
		// T = 2*1 / (5/50) = 2*50/5 = 20ms, clamped to T_MIN.
		expect(result.durationMs).toBe(COMMIT_T_MIN_MS);
	});

	test('velocity pointing away from target falls back to COMMIT_T_DEFAULT_MS', () => {
		// progressDirection = 0 (committing toward 1), current progress = 0.5,
		// release velocity negative (moving leftward while committing rightward).
		const result = solveCommitDuration(baseCommitInput({ releaseVelocityPxPerMs: -2 }), 0.5);
		expect(result.durationMs).toBe(COMMIT_T_DEFAULT_MS);
	});

	test('progress already at target falls back to COMMIT_T_DEFAULT_MS (enforces the <= choice)', () => {
		// progressDirection = 0 (commit, target = 1), currentProgress = 1
		// (already at target): directionSign === 0, so the `<= 0` branch
		// fires and routes to T_DEFAULT (300ms). The `<=` (not `<`) is
		// load-bearing: `<` would let this fall through to the solve and
		// clamp to T_MIN (100ms). This test pins the choice.
		const result = solveCommitDuration(baseCommitInput({ releaseVelocityPxPerMs: 2 }), 1);
		expect(result.durationMs).toBe(COMMIT_T_DEFAULT_MS);
	});

	test('reversed cancel velocity falls back to COMMIT_T_DEFAULT_MS', () => {
		// progressDirection = 1 (cancel, target = 0), currentProgress = 0.5,
		// release velocity positive (moving rightward while the cancel
		// targets 0 = leftward): directionSign = -1, progressVelocity > 0,
		// so directionSign * progressVelocity <= 0 fires. The branch is
		// plan-agnostic; this mirrors the commit-direction reversal above.
		const plan = planStub({ axis: 'left', distance: 375, progressDirection: 1 });
		const result = solveCommitDuration(baseCommitInput({ releaseVelocityPxPerMs: 2, plan }), 0.5);
		expect(result.durationMs).toBe(COMMIT_T_DEFAULT_MS);
	});

	test('progressVelocity sign matches the release velocity sign', () => {
		const positive = solveCommitDuration(baseCommitInput({ releaseVelocityPxPerMs: 2 }), 0);
		const negative = solveCommitDuration(baseCommitInput({ releaseVelocityPxPerMs: -2 }), 0);
		expect(positive.progressVelocity).toBeGreaterThan(0);
		expect(negative.progressVelocity).toBeLessThan(0);
	});

	test('cancel plan (progressDirection 1) solves duration toward target 0', () => {
		// progressDirection = 1 means the plan snaps back to FROM (target=0).
		// Current progress = 0.7, release velocity negative (moving leftward
		// toward 0). Direction-matched.
		const plan = planStub({ axis: 'left', distance: 375, progressDirection: 1 });
		const result = solveCommitDuration(baseCommitInput({ releaseVelocityPxPerMs: -2, plan }), 0.7);
		expect(result.snapped).toBe(false);
		// deltaProgress = 0.7, velocity in progress/ms = -2/375.
		// T = 2*0.7 / (2/375) = 0.7 * 375 = 262.5ms.
		expect(result.durationMs).toBeCloseTo((2 * 0.7 * 375) / 2, 5);
	});
});

// ---------------------------------------------------------------------------
// startCommit.

describe('startCommit', () => {
	test('reduced motion snaps: phase idle, progress jumps to target, no commit metadata', () => {
		const plan = planStub({ axis: 'left', distance: 375, progressDirection: 0 });
		const input = baseCommitInput({ reducedMotion: true, plan });
		const state: ExecutorState = { phase: 'live', progress: 0.3, liveOffset: 5, commitStart: null };
		const next = startCommit(state, input);
		expect(next.phase).toBe('idle');
		expect(next.progress).toBe(1); // target for progressDirection 0
		expect(next.commitStart).toBeNull();
	});

	test('cancel plan + reduced motion snaps progress to 0', () => {
		const plan = planStub({ axis: 'left', distance: 375, progressDirection: 1 });
		const input = baseCommitInput({ reducedMotion: true, plan });
		const state: ExecutorState = { phase: 'live', progress: 0.7, liveOffset: 5, commitStart: null };
		const next = startCommit(state, input);
		expect(next.phase).toBe('idle');
		expect(next.progress).toBe(0); // target for progressDirection 1
		expect(next.commitStart).toBeNull();
	});

	test('momentum commit sets phase committing and preserves current progress', () => {
		const plan = planStub({ axis: 'left', distance: 375, progressDirection: 0 });
		const input = baseCommitInput({ releaseVelocityPxPerMs: 2, plan, now: 1234 });
		const state: ExecutorState = {
			phase: 'live',
			progress: 0.4,
			liveOffset: 30,
			commitStart: null
		};
		const next = startCommit(state, input);
		expect(next.phase).toBe('committing');
		expect(next.progress).toBe(0.4); // preserved at release point
		expect(next.liveOffset).toBe(30); // preserved
		expect(next.commitStart).not.toBeNull();
		expect(next.commitStart?.progressStart).toBe(0.4);
		expect(next.commitStart?.progressTarget).toBe(1);
		expect(next.commitStart?.t0).toBe(1234);
		expect(next.commitStart?.reducedMotion).toBe(false);
	});

	test('commit metadata duration matches solveCommitDuration', () => {
		const plan = planStub({ axis: 'left', distance: 375, progressDirection: 0 });
		const input = baseCommitInput({ releaseVelocityPxPerMs: 1.5, plan });
		const state: ExecutorState = { phase: 'live', progress: 0.2, liveOffset: 0, commitStart: null };
		const next = startCommit(state, input);
		const solved = solveCommitDuration(input, 0.2);
		expect(next.commitStart?.durationMs).toBe(solved.durationMs);
	});
});

// ---------------------------------------------------------------------------
// sampleFrame.

describe('sampleFrame', () => {
	test('sample outside the committing phase is a no-op returning done', () => {
		const plan = planStub({ axis: 'left', distance: 375, progressDirection: 0 });
		const idle = initialExecutorState();
		const sample = sampleFrame(idle, plan, 100);
		expect(sample.done).toBe(true);
		expect(sample.state).toBe(idle);
	});

	test('sample at t = t0 yields the start progress', () => {
		const plan = planStub({ axis: 'left', distance: 375, progressDirection: 0 });
		const state = startCommit(
			{ phase: 'live', progress: 0.3, liveOffset: 0, commitStart: null },
			baseCommitInput({ releaseVelocityPxPerMs: 2, plan, now: 1000 })
		);
		const sample = sampleFrame(state, plan, 1000); // elapsed = 0
		expect(sample.done).toBe(false);
		expect(sample.state.progress).toBeCloseTo(0.3, 5);
	});

	test('sample at t = t0 + duration yields target progress and done', () => {
		const plan = planStub({ axis: 'left', distance: 375, progressDirection: 0 });
		const state = startCommit(
			{ phase: 'live', progress: 0.3, liveOffset: 0, commitStart: null },
			baseCommitInput({ releaseVelocityPxPerMs: 2, plan, now: 1000 })
		);
		const duration = state.commitStart?.durationMs ?? 0;
		const sample = sampleFrame(state, plan, 1000 + duration);
		expect(sample.done).toBe(true);
		expect(sample.state.progress).toBeCloseTo(1, 5);
	});

	test('sample at t > duration clamps progress to target and is done', () => {
		const plan = planStub({ axis: 'left', distance: 375, progressDirection: 0 });
		const state = startCommit(
			{ phase: 'live', progress: 0.3, liveOffset: 0, commitStart: null },
			baseCommitInput({ releaseVelocityPxPerMs: 2, plan, now: 1000 })
		);
		const duration = state.commitStart?.durationMs ?? 0;
		const sample = sampleFrame(state, plan, 1000 + duration * 3);
		expect(sample.done).toBe(true);
		expect(sample.state.progress).toBeCloseTo(1, 5);
	});

	test('progress is monotonic across the commit (forward, target = 1)', () => {
		const plan = planStub({ axis: 'left', distance: 375, progressDirection: 0 });
		const state = startCommit(
			{ phase: 'live', progress: 0.1, liveOffset: 0, commitStart: null },
			baseCommitInput({ releaseVelocityPxPerMs: 1, plan, now: 0 })
		);
		const duration = state.commitStart?.durationMs ?? 0;
		const progressSamples: number[] = [];
		for (let i = 0; i <= 20; i += 1) {
			const t = (duration * i) / 20;
			const sample = sampleFrame(state, plan, t);
			progressSamples.push(sample.state.progress);
		}
		for (let i = 1; i < progressSamples.length; i += 1) {
			expect(progressSamples[i]).toBeGreaterThanOrEqual(progressSamples[i - 1] - 1e-9);
		}
		// Final sample at target.
		expect(progressSamples[progressSamples.length - 1]).toBeCloseTo(1, 5);
	});

	test('progress is monotonic across a cancel commit (target = 0)', () => {
		const plan = planStub({ axis: 'left', distance: 375, progressDirection: 1 });
		const state = startCommit(
			{ phase: 'live', progress: 0.9, liveOffset: 0, commitStart: null },
			baseCommitInput({ releaseVelocityPxPerMs: -1, plan, now: 0 })
		);
		const duration = state.commitStart?.durationMs ?? 0;
		const progressSamples: number[] = [];
		for (let i = 0; i <= 20; i += 1) {
			const t = (duration * i) / 20;
			const sample = sampleFrame(state, plan, t);
			progressSamples.push(sample.state.progress);
		}
		for (let i = 1; i < progressSamples.length; i += 1) {
			expect(progressSamples[i]).toBeLessThanOrEqual(progressSamples[i - 1] + 1e-9);
		}
		expect(progressSamples[progressSamples.length - 1]).toBeCloseTo(0, 5);
	});

	test('the ease curve matches s(u) = 2u - u² at the midpoint', () => {
		const plan = planStub({ axis: 'left', distance: 375, progressDirection: 0 });
		const state = startCommit(
			{ phase: 'live', progress: 0, liveOffset: 0, commitStart: null },
			baseCommitInput({ releaseVelocityPxPerMs: 1, plan, now: 0 })
		);
		const duration = state.commitStart?.durationMs ?? 0;
		const sample = sampleFrame(state, plan, duration / 2);
		// s(0.5) = 2*0.5 - 0.25 = 0.75.
		expect(sample.state.progress).toBeCloseTo(0.75, 5);
	});
});

// ---------------------------------------------------------------------------
// publishFrame + tickFrame (driver write side).

describe('publishFrame + tickFrame', () => {
	test('publishFrame writes one visual through the driver', () => {
		const plan = planStub({ axis: 'left', distance: 375, progressDirection: 0 });
		const driver = new MockNavDomDriver();
		const state: ExecutorState = {
			phase: 'live',
			progress: 0.5,
			liveOffset: 10,
			commitStart: null
		};
		publishFrame(state, plan, driver);
		expect(driver.writes.length).toBe(1);
		expect(driver.lastWrite?.pageTrack.translateX).toBe(-187.5);
		expect(driver.lastWrite?.fab.scale).toBeCloseTo(0.5, 5);
	});

	test('tickFrame samples one commit step and publishes it in one call', () => {
		const plan = planStub({ axis: 'left', distance: 375, progressDirection: 0 });
		const driver = new MockNavDomDriver();
		const start = startCommit(
			{ phase: 'live', progress: 0, liveOffset: 0, commitStart: null },
			baseCommitInput({ releaseVelocityPxPerMs: 1, plan, now: 0 })
		);
		const duration = start.commitStart?.durationMs ?? 0;
		const sample = tickFrame(start, plan, duration / 2, driver);
		expect(sample.done).toBe(false);
		expect(driver.writes.length).toBe(1);
		expect(driver.lastWrite?.pageTrack.translateX).toBeCloseTo(-375 * 0.75, 3);
	});
});

// ---------------------------------------------------------------------------
// Reduced-motion end-to-end through the executor (snap path).

describe('reduced-motion end-to-end', () => {
	test('snap produces a single write at the target and the rAF would not run', () => {
		// The reactive shell checks `driver.prefersReducedMotion()` and
		// passes the flag to startCommit. For reduced motion startCommit
		// returns idle with progress = target; the shell publishes once
		// and does not schedule the rAF.
		const plan = planStub({ axis: 'left', distance: 375, progressDirection: 0 });
		const driver = new MockNavDomDriver({ reducedMotion: true });
		const fromLive: ExecutorState = {
			phase: 'live',
			progress: 0.3,
			liveOffset: 0,
			commitStart: null
		};
		const next = startCommit(
			fromLive,
			baseCommitInput({ reducedMotion: driver.prefersReducedMotion(), plan, now: 0 })
		);
		publishFrame(next, plan, driver);
		expect(driver.writes.length).toBe(1);
		expect(driver.lastWrite?.pageTrack.translateX).toBe(-375); // progress = 1
		// phase idle: sampleFrame is a no-op, the shell would stop the rAF.
		expect(next.phase).toBe('idle');
		expect(sampleFrame(next, plan, 100).done).toBe(true);
	});
});

describe('shouldScheduleRaf', () => {
	test('schedules only in the browser with no rAF in flight', () => {
		expect(shouldScheduleRaf(true, false)).toBe(true);
		// single-flight: a rAF already in flight is not rescheduled.
		expect(shouldScheduleRaf(true, true)).toBe(false);
		// SSR: no requestAnimationFrame available.
		expect(shouldScheduleRaf(false, false)).toBe(false);
		expect(shouldScheduleRaf(false, true)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Track geometry helpers (interrupt handoff). A new transition that
// interrupts an in-flight one must start at the track's current visual
// position. The handoff converts through the absolute translateX:
// `trackTranslateX(runningPlan, currentProgress)` then
// `progressAtTranslateX(newPlan, thatTx)`. This is the pure core of the
// orchestrator's #startProgressFromCurrentVisual.

describe('track geometry helpers (interrupt handoff)', () => {
	// A minimal plan exercising only the page-track geometry; the fab /
	// header consumer stubs are unused by the geometry helpers.
	function trackPlan(
		axis: 'left' | 'right',
		distance: number,
		restingTranslate: number
	): TransitionPlan {
		return {
			pageTrack: { axis, distance, restingTranslate },
			fab: () => ({ scale: 0, translateY: 0, visible: false }),
			header: () => ({ morph: 0, titleCrossfade: 0, translateY: 0 }),
			progressDirection: 0,
			commitPhysics: 'momentum'
		};
	}

	test('trackTranslateX matches buildVisual across axis + restingTranslate', () => {
		const plans = [
			trackPlan('left', 375, 0),
			trackPlan('left', 375, -375),
			trackPlan('right', 375, -375),
			trackPlan('right', 200, 0)
		];
		for (const plan of plans) {
			for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
				expect(trackTranslateX(plan, progress)).toBeCloseTo(
					buildVisual(plan, progress, 0).pageTrack.translateX,
					7
				);
			}
		}
	});

	test('progressAtTranslateX is the inverse of trackTranslateX', () => {
		const plans = [
			trackPlan('left', 375, 0),
			trackPlan('left', 375, -375),
			trackPlan('right', 375, -375),
			trackPlan('right', 200, 0)
		];
		for (const plan of plans) {
			for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
				const tx = trackTranslateX(plan, progress);
				expect(progressAtTranslateX(plan, tx)).toBeCloseTo(progress, 7);
			}
		}
	});

	test('forward-enter progress maps to back-swipe progress via absolute position', () => {
		// The pilot's two plans share one track with opposite progress
		// conventions: enter slides 0 -> -W (progress 0 -> 1); back-swipe
		// slides -W -> 0 (progress 0 -> 1). An interrupt must start the
		// back-swipe at the enter's current visual position.
		const W = 393;
		const enter = trackPlan('left', W, 0);
		const backSwipe = trackPlan('right', W, -W);
		// Enter at 0.4 sits at tx -0.4W -> back-swipe starts at 0.6.
		expect(progressAtTranslateX(backSwipe, trackTranslateX(enter, 0.4))).toBeCloseTo(0.6, 7);
		// Symmetric: back-swipe at 0.3 -> enter would resume at 0.7.
		expect(progressAtTranslateX(enter, trackTranslateX(backSwipe, 0.3))).toBeCloseTo(0.7, 7);
	});

	test('progressAtTranslateX clamps when tx is outside the plan span', () => {
		const plan = trackPlan('left', 375, 0); // travelled span [0, -375]
		expect(progressAtTranslateX(plan, 100)).toBe(0); // above 0 -> progress 0
		expect(progressAtTranslateX(plan, -500)).toBe(1); // below -375 -> progress 1
	});

	test('progressAtTranslateX returns 0 for a zero-distance plan', () => {
		expect(progressAtTranslateX(trackPlan('left', 0, 0), 50)).toBe(0);
	});
});
