// src/lib/utils/nav-intent.test.ts
/**
 * Unit suite for the Layer 2 intent classifier (nav-intent.ts). Covers
 * the §6 micro-state transitions, the edge-dead-zone yield, the
 * velocity-sample ring buffer, and the four target-bearing intents
 * (tap/popstate/hashchange/goto). The classifier is pure so the suite
 * runs under `bun:test` with no Svelte runes loader.
 */

import { describe, test, expect } from 'bun:test';
import {
	classify,
	DEFAULT_CLASSIFIER_OPTIONS,
	estimateVelocity,
	initialIntentState,
	intentTarget,
	isEdgeReserve,
	resolveDirection,
	type IntentEvent,
	type IntentState
} from './nav-intent';

const OPTS = DEFAULT_CLASSIFIER_OPTIONS;
const VW = 375;

function down(x: number, t = 0): IntentEvent {
	return { kind: 'pointerdown', x, y: 0, t, target: null };
}
function move(x: number, t: number): IntentEvent {
	return { kind: 'pointermove', x, y: 0, t, target: null };
}
function up(x: number, t: number): IntentEvent {
	return { kind: 'pointerup', x, y: 0, t, target: null };
}
function cancel(): IntentEvent {
	return { kind: 'pointercancel', x: 0, y: 0, t: 0, target: null };
}
function tap(target: string, t = 0): IntentEvent {
	return { kind: 'tap', x: 0, y: 0, t, target };
}
function goto(target: string, t = 0): IntentEvent {
	return { kind: 'goto', x: 0, y: 0, t, target };
}
function popstateTo(target: string, t = 0): IntentEvent {
	return { kind: 'popstate', x: 0, y: 0, t, target };
}

describe('intent classifier: edge-dead-zone', () => {
	test('a pointerdown inside the left edge reserve yields to idle', () => {
		const next = classify(initialIntentState(), down(20), OPTS, VW);
		expect(next.micro).toBe('idle');
	});

	test('a pointerdown inside the right edge reserve yields to idle', () => {
		const next = classify(initialIntentState(), down(VW - 10), OPTS, VW);
		expect(next.micro).toBe('idle');
	});

	test('isEdgeReserve matches the same condition the classifier uses', () => {
		expect(isEdgeReserve(20, VW, OPTS.edgeDeadZone)).toBe(true);
		expect(isEdgeReserve(VW - 10, VW, OPTS.edgeDeadZone)).toBe(true);
		expect(isEdgeReserve(80, VW, OPTS.edgeDeadZone)).toBe(false);
	});
});

describe('intent classifier: pointerdown -> deciding', () => {
	test('a pointerdown outside the reserve enters deciding and records the start', () => {
		const next = classify(initialIntentState(), down(100, 1000), OPTS, VW);
		expect(next.micro).toBe('deciding');
		expect(next.startX).toBe(100);
		expect(next.startedAt).toBe(1000);
		expect(next.direction).toBeNull();
		expect(next.offset).toBe(0);
		expect(next.samples.length).toBe(1);
	});
});

describe('intent classifier: pointermove decides and updates', () => {
	test('a sub-threshold move stays in deciding', () => {
		let s = classify(initialIntentState(), down(100, 0), OPTS, VW);
		s = classify(s, move(105, 10), OPTS, VW);
		expect(s.micro).toBe('deciding');
		expect(s.direction).toBeNull();
	});

	test('a rightward super-threshold move enters drag-right', () => {
		let s = classify(initialIntentState(), down(100, 0), OPTS, VW);
		s = classify(s, move(130, 10), OPTS, VW);
		expect(s.micro).toBe('drag-right');
		expect(s.direction).toBe('right');
		expect(s.offset).toBe(30);
		expect(s.velocity).toBeGreaterThan(0);
	});

	test('a leftward super-threshold move enters drag-left', () => {
		let s = classify(initialIntentState(), down(200, 0), OPTS, VW);
		s = classify(s, move(150, 10), OPTS, VW);
		expect(s.micro).toBe('drag-left');
		expect(s.direction).toBe('left');
		expect(s.offset).toBe(-50);
		expect(s.velocity).toBeLessThan(0);
	});

	test('a move while idle is a no-op (no gesture to track)', () => {
		const idle = initialIntentState();
		const next = classify(idle, move(200, 10), OPTS, VW);
		expect(next).toBe(idle);
	});

	test('resolveDirection returns null below the threshold', () => {
		expect(resolveDirection(5, OPTS.decideThresholdPx)).toBeNull();
	});

	test('resolveDirection returns right/left past the threshold', () => {
		expect(resolveDirection(20, OPTS.decideThresholdPx)).toBe('right');
		expect(resolveDirection(-20, OPTS.decideThresholdPx)).toBe('left');
	});
});

describe('intent classifier: pointerup commits or cancels', () => {
	test('pointerup after a forward drag commits and freezes release velocity', () => {
		let s = classify(initialIntentState(), down(100, 0), OPTS, VW);
		s = classify(s, move(150, 100), OPTS, VW);
		s = classify(s, up(150, 110), OPTS, VW);
		expect(s.micro).toBe('committed');
		expect(s.releaseVelocity).toBe(s.velocity);
	});

	test('pointerup after a reversed drag cancels', () => {
		let s = classify(initialIntentState(), down(100, 0), OPTS, VW);
		s = classify(s, move(150, 100), OPTS, VW); // drag-right
		s = classify(s, move(50, 200), OPTS, VW); // cross back past start
		expect(s.reversed).toBe(true);
		s = classify(s, up(50, 210), OPTS, VW);
		expect(s.micro).toBe('cancelled');
	});

	test('pointerup while deciding returns to idle (no gesture)', () => {
		let s = classify(initialIntentState(), down(100, 0), OPTS, VW);
		s = classify(s, move(105, 10), OPTS, VW); // sub-threshold
		s = classify(s, up(105, 20), OPTS, VW);
		expect(s.micro).toBe('idle');
	});

	test('pointercancel transitions an active drag to cancelled', () => {
		let s = classify(initialIntentState(), down(100, 0), OPTS, VW);
		s = classify(s, move(150, 100), OPTS, VW);
		s = classify(s, cancel(), OPTS, VW);
		expect(s.micro).toBe('cancelled');
	});

	test('pointercancel on an idle state is a no-op', () => {
		const idle = initialIntentState();
		const next = classify(idle, cancel(), OPTS, VW);
		expect(next).toBe(idle);
	});
});

describe('intent classifier: target-bearing intents', () => {
	test('tap produces a committed intent with the target pathname', () => {
		const s = classify(initialIntentState(), tap('/search', 5), OPTS, VW);
		expect(s.micro).toBe('committed');
		expect(s.target).toBe('/search');
		expect(s.startedAt).toBe(5);
	});

	test('goto produces a committed intent with the target pathname', () => {
		const s = classify(initialIntentState(), goto('/bookmarks'), OPTS, VW);
		expect(s.micro).toBe('committed');
		expect(s.target).toBe('/bookmarks');
	});

	test('popstate produces a committed intent with the target pathname', () => {
		const s = classify(initialIntentState(), popstateTo('/'), OPTS, VW);
		expect(s.micro).toBe('committed');
		expect(s.target).toBe('/');
	});

	test('a target-bearing intent without a target is a no-op', () => {
		const event: IntentEvent = { kind: 'goto', x: 0, y: 0, t: 0, target: null };
		const idle = initialIntentState();
		const next = classify(idle, event, OPTS, VW);
		expect(next).toBe(idle);
	});

	test('intentTarget extracts the resolved target', () => {
		const s = classify(initialIntentState(), goto('/profile'), OPTS, VW);
		const target = intentTarget(s);
		expect(target?.pathname).toBe('/profile');
	});

	test('intentTarget returns null for a drag-only intent', () => {
		let s: IntentState = classify(initialIntentState(), down(100, 0), OPTS, VW);
		s = classify(s, move(150, 10), OPTS, VW);
		expect(intentTarget(s)).toBeNull();
	});
});

describe('intent classifier: velocity ring buffer', () => {
	test('the sample buffer is bounded to VELOCITY_SAMPLE_COUNT', () => {
		let s = classify(initialIntentState(), down(100, 0), OPTS, VW);
		for (let i = 1; i <= 10; i += 1) {
			s = classify(s, move(100 + i * 5, i * 10), OPTS, VW);
		}
		expect(s.samples.length).toBe(5);
	});

	test('estimateVelocity is zero for fewer than two samples', () => {
		expect(estimateVelocity([])).toBe(0);
		expect(estimateVelocity([{ x: 10, t: 0 }])).toBe(0);
	});

	test('estimateVelocity returns the slope of the first-to-last sample', () => {
		const samples = [
			{ x: 100, t: 0 },
			{ x: 110, t: 10 },
			{ x: 130, t: 20 }
		];
		// (130 - 100) / 20 = 1.5 px/ms
		expect(estimateVelocity(samples)).toBeCloseTo(1.5, 5);
	});

	test('estimateVelocity is zero when the time delta is non-positive', () => {
		const samples = [
			{ x: 100, t: 10 },
			{ x: 110, t: 10 }
		];
		expect(estimateVelocity(samples)).toBe(0);
	});
});
