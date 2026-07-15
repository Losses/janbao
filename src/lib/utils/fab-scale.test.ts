import { describe, test, expect } from 'bun:test';
import { fabScale, hideProgress, translateYFromHideProgress } from './fab-scale';

describe('fabScale', () => {
	test('at rest (progress = 1): visible route -> 1, hidden route -> 0', () => {
		expect(fabScale(1, true, true)).toBe(1);
		expect(fabScale(1, false, false)).toBe(0);
	});

	test('both have FAB: dips to 0 at the midpoint', () => {
		expect(fabScale(0, true, true)).toBe(1);
		expect(fabScale(0.25, true, true)).toBe(0.5);
		expect(fabScale(0.5, true, true)).toBe(0);
		expect(fabScale(0.75, true, true)).toBe(0.5);
		expect(fabScale(1, true, true)).toBe(1);
	});

	test('from only: exit first half, stay 0', () => {
		expect(fabScale(0, true, false)).toBe(1);
		expect(fabScale(0.25, true, false)).toBe(0.5);
		expect(fabScale(0.5, true, false)).toBe(0);
		expect(fabScale(0.75, true, false)).toBe(0);
		expect(fabScale(1, true, false)).toBe(0);
	});

	test('to only: stay 0, enter second half', () => {
		expect(fabScale(0, false, true)).toBe(0);
		expect(fabScale(0.25, false, true)).toBe(0);
		expect(fabScale(0.5, false, true)).toBe(0);
		expect(fabScale(0.75, false, true)).toBe(0.5);
		expect(fabScale(1, false, true)).toBe(1);
	});

	test('neither: always 0', () => {
		expect(fabScale(0, false, false)).toBe(0);
		expect(fabScale(0.5, false, false)).toBe(0);
		expect(fabScale(1, false, false)).toBe(0);
	});

	test('clamps outside [0, 1] progress', () => {
		expect(fabScale(-0.5, true, true)).toBe(1);
		expect(fabScale(1.5, true, true)).toBe(1);
		expect(fabScale(-1, true, false)).toBe(1);
		expect(fabScale(2, false, true)).toBe(1);
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
