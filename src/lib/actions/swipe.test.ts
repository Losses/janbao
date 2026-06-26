import { describe, test, expect } from 'bun:test';
import { releaseVelocity, reversedAtRelease } from './swipe';

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
