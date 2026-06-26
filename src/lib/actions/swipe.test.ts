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
 * motion right before lift-off. These tests pin its contract because it is the
 * signal that drives the "flicked back at release" cancellation.
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
		// Old samples show strong rightward motion; the last 80ms show a reversal
		// back to the left. The release velocity must reflect the recent reversal,
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
		// All motion happened long ago; nothing inside the trailing window except
		// the final held position -> undersampled -> 0 (commit falls back to position).
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
 * on: a release moving against the drag direction cancels, so a swipe that
 * crossed the threshold but was flicked back returns to the origin.
 */
describe('reversedAtRelease', () => {
	test('not reversed when release motion continues the drag direction', () => {
		// Dragged right (deltaX > 0), still moving right at release.
		expect(reversedAtRelease(120, 0.8)).toBe(false);
		// Dragged left (deltaX < 0), still moving left at release.
		expect(reversedAtRelease(-120, -0.8)).toBe(false);
	});

	test('reversed when the release flicks back against the drag direction', () => {
		// Dragged right past the threshold, flicked left at release.
		expect(reversedAtRelease(120, -0.6)).toBe(true);
		// Dragged left past the threshold, flicked right at release.
		expect(reversedAtRelease(-120, 0.6)).toBe(true);
	});

	test('sub-floor jitter does not cancel a position-qualified commit', () => {
		// A tiny opposite nudge below the cancellation floor is treated as noise.
		expect(reversedAtRelease(120, -0.1)).toBe(false);
		expect(reversedAtRelease(-120, 0.1)).toBe(false);
	});

	test('zero displacement is never a reversal', () => {
		expect(reversedAtRelease(0, 0.5)).toBe(false);
		expect(reversedAtRelease(0, -0.5)).toBe(false);
	});
});
