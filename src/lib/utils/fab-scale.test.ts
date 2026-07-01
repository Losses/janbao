import { describe, test, expect } from 'bun:test';
import {
	scaleFromFraction,
	tabFraction,
	familyNeedsSamplerDuringDrag,
	hideProgress,
	translateYFromHideProgress
} from './fab-scale';

describe('scaleFromFraction', () => {
	test('identity over [0, 1] (FAB tracks the gesture across the full range)', () => {
		expect(scaleFromFraction(0)).toBe(0);
		expect(scaleFromFraction(0.25)).toBe(0.25);
		expect(scaleFromFraction(0.5)).toBe(0.5);
		expect(scaleFromFraction(0.75)).toBe(0.75);
		expect(scaleFromFraction(1)).toBe(1);
	});

	test('clamps to [0, 1]', () => {
		expect(scaleFromFraction(-1)).toBe(0);
		expect(scaleFromFraction(1.5)).toBe(1);
	});
});

describe('tabFraction', () => {
	test('sample === tabIndex -> 1 (fully foreground)', () => {
		expect(tabFraction(0, 0)).toBe(1);
		expect(tabFraction(2, 2)).toBe(1);
		expect(tabFraction(1.5, 1.5)).toBe(1);
	});

	test('sample one tab away -> 0 (fully covered)', () => {
		expect(tabFraction(1, 0)).toBe(0);
		expect(tabFraction(0, 1)).toBe(0);
		expect(tabFraction(3, 2)).toBe(0);
	});

	test('linear between integer tabs', () => {
		expect(tabFraction(0.25, 0)).toBe(0.75);
		expect(tabFraction(0.5, 0)).toBe(0.5);
		expect(tabFraction(0.75, 0)).toBe(0.25);
	});

	test('clamps beyond one tab away', () => {
		expect(tabFraction(2, 0)).toBe(0);
		expect(tabFraction(-1, 0)).toBe(0);
	});

	test('fractional tab index interpolates symmetrically', () => {
		// Between tab 0 and tab 1: distance from 0.5 to either is 0.5 -> 0.5.
		expect(tabFraction(0.5, 0)).toBe(0.5);
		expect(tabFraction(0.5, 1)).toBe(0.5);
	});
});

describe('familyNeedsSamplerDuringDrag', () => {
	test('Family A (list) -> true (live fractionalIndex jumps on release; sampler covers drag + snap)', () => {
		expect(familyNeedsSamplerDuringDrag('list')).toBe(true);
	});

	test('Family B (overlay) -> false (reads live coverProgress from the store)', () => {
		expect(familyNeedsSamplerDuringDrag('overlay')).toBe(false);
	});

	test('Family C (compose) -> false (no sibling track to sample)', () => {
		expect(familyNeedsSamplerDuringDrag('compose')).toBe(false);
	});

	test('only the list family is sampler-driven', () => {
		const families = ['list', 'overlay', 'compose'] as const;
		const samplerDriven = families.filter(familyNeedsSamplerDuringDrag);
		expect(samplerDriven).toEqual(['list']);
	});
});

describe('hideProgress', () => {
	test('translateY = 0 -> 0 (Header visible, FAB at rest)', () => {
		expect(hideProgress(0, 56)).toBe(0);
	});

	test('translateY = -headerHeight -> 1 (Header fully hidden)', () => {
		expect(hideProgress(-56, 56)).toBe(1);
	});

	test('linear between 0 and -headerHeight', () => {
		expect(hideProgress(-14, 56)).toBe(0.25);
		expect(hideProgress(-28, 56)).toBe(0.5);
		expect(hideProgress(-42, 56)).toBe(0.75);
	});

	test('clamps beyond the Header range', () => {
		expect(hideProgress(-100, 56)).toBe(1);
		expect(hideProgress(20, 56)).toBe(0);
	});

	test('non-positive headerHeight -> 0 (division-safe)', () => {
		expect(hideProgress(-10, 0)).toBe(0);
		expect(hideProgress(-10, -1)).toBe(0);
	});
});

describe('translateYFromHideProgress', () => {
	test('p = 0 -> 0 (FAB at rest)', () => {
		expect(translateYFromHideProgress(0, 56, 16)).toBe(0);
	});

	test('p = 1 -> fabHeight + bottomClearance', () => {
		expect(translateYFromHideProgress(1, 56, 16)).toBe(72);
	});

	test('linear in between', () => {
		expect(translateYFromHideProgress(0.5, 56, 16)).toBe(36);
	});

	test('clamps p outside [0, 1]', () => {
		expect(translateYFromHideProgress(2, 56, 16)).toBe(72);
		expect(translateYFromHideProgress(-1, 56, 16)).toBe(0);
	});
});
