import { describe, test, expect } from 'bun:test';
import { releaseVelocity, reversedAtRelease, shouldCancelOnRelease } from './swipe';

// Minimal shape for PositionSample (kept internal in swipe.ts); structural
// typing lets the tests build samples without importing the interface.
interface Sample {
	x: number;
	t: number;
}

/**
 * releaseVelocity is the recognizer's windowed measurement of the finger's
 * motion right before lift-off. These tests pin its contract because it feeds
 * the velocity gate of the "flicked back at release" cancellation.
 */
describe('releaseVelocity', () => {
	test('net displacement over the trailing window, in px/ms', () => {
		// 120px of rightward travel over 100ms -> 1.2 px/ms.
		const samples: Sample[] = [
			{ x: 0, t: 0 },
			{ x: 120, t: 100 }
		];
		expect(releaseVelocity(samples)).toBeCloseTo(1.2, 5);
	});

	test('negative for leftward motion', () => {
		const samples: Sample[] = [
			{ x: 0, t: 0 },
			{ x: -80, t: 100 }
		];
		expect(releaseVelocity(samples)).toBeCloseTo(-0.8, 5);
	});

	test('ignores aged samples outside the ~80ms window (trailing motion wins)', () => {
		// Mirrors a long drag whose early forward travel was pruned by the
		// 32-sample cap: the release velocity must reflect the recent reversal,
		// not the stale forward travel.
		const samples: Sample[] = [
			{ x: 0, t: 0 },
			{ x: 300, t: 50 },
			{ x: 300, t: 200 },
			{ x: 240, t: 280 }
		];
		// Window [200, 280]: displacement 240 - 300 = -60 over 80ms -> -0.75 px/ms.
		expect(releaseVelocity(samples)).toBeCloseTo(-0.75, 5);
	});

	test('returns 0 when the finger paused before lift-off (no recent samples)', () => {
		const samples: Sample[] = [
			{ x: 0, t: 0 },
			{ x: 200, t: 50 },
			{ x: 200, t: 500 }
		];
		expect(releaseVelocity(samples)).toBe(0);
	});

	test('returns 0 for fewer than two samples', () => {
		expect(releaseVelocity([])).toBe(0);
		expect(releaseVelocity([{ x: 50, t: 50 }])).toBe(0);
	});

	test('returns 0 when the window collapses to a single instant (dt = 0)', () => {
		const samples: Sample[] = [
			{ x: 10, t: 100 },
			{ x: 40, t: 100 }
		];
		expect(releaseVelocity(samples)).toBe(0);
	});
});

/**
 * reversedAtRelease is the shared policy every swipe consumer gates its commit
 * on. `rebound` (peak − final position, px) leads: at lift-off the finger is
 * usually already still, so a "dragged back and paused" gesture has velocity
 * ≈ 0 and only the rebound exposes the change of intent. A genuine forward
 * fling (still moving toward the target) is exempt so it still commits.
 *
 * The first three cases are transcribed from real device captures:
 *   A = clean fling, B = drag-then-pullback-and-pause, case 3 = a smaller pullback.
 */
describe('reversedAtRelease', () => {
	test('clean forward fling (no pullback, fast) does not reverse', () => {
		// Capture A: deltaX=342, velocity=+2.341, rebound=1.
		expect(reversedAtRelease(342, 2.341, 1)).toBe(false);
	});

	test('pullback then pause (large rebound, ~0 velocity) reverses', () => {
		// Capture B: deltaX=308, velocity=-0.092, rebound=61.
		expect(reversedAtRelease(308, -0.092, 61)).toBe(true);
	});

	test('moderate pullback with slight negative velocity reverses', () => {
		// Capture "first": deltaX=232, velocity=-0.149, rebound=29.
		expect(reversedAtRelease(232, -0.149, 29)).toBe(true);
	});

	test('rebound below the threshold does not reverse (minor pullback is noise)', () => {
		expect(reversedAtRelease(200, 0, 24)).toBe(false);
	});

	test('rebound at the threshold with a still finger reverses', () => {
		expect(reversedAtRelease(200, 0, 25)).toBe(true);
	});

	test('a forward fling commits despite trailing rebound (finger still on target)', () => {
		// rebound is large but the finger is still moving toward the target.
		expect(reversedAtRelease(200, 0.5, 61)).toBe(false);
	});

	test('leftward drag is symmetric: pullback reverses, fling commits', () => {
		// Pullback (finger drifting back right) reverses.
		expect(reversedAtRelease(-308, 0.092, 61)).toBe(true);
		// Clean leftward fling commits.
		expect(reversedAtRelease(-342, -2.341, 1)).toBe(false);
		// Leftward fling still on target commits despite rebound.
		expect(reversedAtRelease(-200, -0.5, 61)).toBe(false);
	});

	test('zero displacement never reverses', () => {
		expect(reversedAtRelease(0, 0.5, 100)).toBe(false);
	});
});

/**
 * shouldCancelOnRelease is the gate every swipe consumer's `onEnd` consults to
 * decide commit vs. snap-back. It ORs `reversedAtRelease` with a
 * `pointercancel` term: a system-interrupted gesture (browser/OS revoking the
 * pointer mid-drag, e.g. for a native pan or notification) must NEVER commit on
 * the displacement that existed at the instant of cancellation. The user is no
 * longer driving the swipe, so the release policy does not apply.
 *
 * These tests pin the pointercancel term's dominance: a future edit that drops
 * it (e.g. by collapsing the function to `reversedAtRelease` alone) would let
 * every "would-commit" case below silently re-introduce the bug class, so each
 * case asserts `shouldCancelOnRelease` returns `true` for `pointercancel`
 * regardless of `deltaX`, `velocity`, or `rebound`.
 */
describe('shouldCancelOnRelease', () => {
	// Build a PointerEvent-shaped object with only the `type` field the
	// function reads. `shouldCancelOnRelease` is pure: it consults `event.type`
	// and the numeric release metrics, nothing else.
	function pointerEvent(type: 'pointerup' | 'pointercancel'): PointerEvent {
		return { type } as PointerEvent;
	}

	test('pointercancel cancels regardless of displacement, velocity, or rebound', () => {
		// A pointercancel arriving mid-commit-drag (large displacement, no
		// rebound, finger still moving toward the target) is the exact case
		// `reversedAtRelease` alone would let commit. The pointercancel term
		// must dominate.
		expect(shouldCancelOnRelease(pointerEvent('pointercancel'), 308, 2.341, 1)).toBe(true);
	});

	test('pointercancel cancels even when the finger would have committed on a clean forward fling', () => {
		// Clean fling capture (deltaX=342, velocity=+2.341, rebound=1): the
		// canonical "commit" case. A pointercancel at the instant of lift-off
		// must still snap back.
		expect(shouldCancelOnRelease(pointerEvent('pointercancel'), 342, 2.341, 1)).toBe(true);
	});

	test('pointercancel cancels a leftward fling that would have committed', () => {
		// Symmetric coverage: a leftward fling still on target (would commit
		// for a pointerup) cancels under pointercancel.
		expect(shouldCancelOnRelease(pointerEvent('pointercancel'), -342, -2.341, 1)).toBe(true);
	});

	test('pointercancel cancels at zero displacement (no gesture even started)', () => {
		// A pointercancel before any movement (deltaX=0): the function must
		// still return true so a release handler treats it as a cancel even
		// though `reversedAtRelease` returns false for deltaX=0.
		expect(shouldCancelOnRelease(pointerEvent('pointercancel'), 0, 0, 0)).toBe(true);
	});

	test('pointercancel cancels with a sub-threshold displacement that would not have committed anyway', () => {
		// Guards against the "only apply pointercancel when above commit
		// threshold" mis-optimization: the cancel signal must be unconditional.
		expect(shouldCancelOnRelease(pointerEvent('pointercancel'), 30, 0, 0)).toBe(true);
	});

	test('pointerup with pointercancel-like metrics does NOT force-cancel (negative case)', () => {
		// A genuine pointerup that meets the commit criteria (forward fling,
		// low rebound) must still commit. This pins that the `pointerup` term
		// does not contribute to cancellation: only `pointercancel` does.
		expect(shouldCancelOnRelease(pointerEvent('pointerup'), 342, 2.341, 1)).toBe(false);
	});

	test('pointerup with a rebound-based reversal still cancels (the OR clause)', () => {
		// The function ORs pointercancel with `reversedAtRelease`. A pointerup
		// with a large rebound cancels via the second clause, confirming the
		// OR composition is intact in both directions.
		expect(shouldCancelOnRelease(pointerEvent('pointerup'), 308, -0.092, 61)).toBe(true);
	});
});
