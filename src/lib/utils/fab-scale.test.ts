import { describe, test, expect } from 'bun:test';
import {
	scaleFromFraction,
	tabFraction,
	pxToFraction,
	listForegroundFromThreadCover,
	familyNeedsSamplerDuringDrag,
	hideProgress,
	translateYFromHideProgress
} from './fab-scale';

describe('scaleFromFraction', () => {
	test('f <= 0.5 -> 0 (disappear in the first half)', () => {
		expect(scaleFromFraction(0)).toBe(0);
		expect(scaleFromFraction(0.25)).toBe(0);
		expect(scaleFromFraction(0.5)).toBe(0);
	});

	test('f >= 1 -> 1 (appear completes at full foreground)', () => {
		expect(scaleFromFraction(1)).toBe(1);
		expect(scaleFromFraction(1.5)).toBe(1);
	});

	test('linear 0 -> 1 over f in [0.5, 1]', () => {
		expect(scaleFromFraction(0.5)).toBe(0);
		expect(scaleFromFraction(0.625)).toBe(0.25);
		expect(scaleFromFraction(0.75)).toBe(0.5);
		expect(scaleFromFraction(0.875)).toBe(0.75);
		expect(scaleFromFraction(1)).toBe(1);
	});

	test('clamps negatives', () => {
		expect(scaleFromFraction(-1)).toBe(0);
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

describe('pxToFraction', () => {
	test('m41 = 0 -> 0 (no slide)', () => {
		expect(pxToFraction(0, 400)).toBe(0);
	});

	test('m41 = -width -> 1 (one full panel slide)', () => {
		expect(pxToFraction(-400, 400)).toBe(1);
	});

	test('linear between 0 and -width', () => {
		expect(pxToFraction(-100, 400)).toBe(0.25);
		expect(pxToFraction(-200, 400)).toBe(0.5);
		expect(pxToFraction(-300, 400)).toBe(0.75);
	});

	test('clamps beyond [0, 1]', () => {
		expect(pxToFraction(-500, 400)).toBe(1);
		expect(pxToFraction(100, 400)).toBe(0);
	});

	test('non-positive width -> 0 (division-safe)', () => {
		expect(pxToFraction(-100, 0)).toBe(0);
		expect(pxToFraction(-100, -1)).toBe(0);
	});
});

describe('listForegroundFromThreadCover', () => {
	test('threadCoverProgress 0 -> list foreground 1 (list preview visible)', () => {
		expect(listForegroundFromThreadCover(0)).toBe(1);
	});

	test('threadCoverProgress 1 -> list foreground 0 (thread covers the list at rest)', () => {
		expect(listForegroundFromThreadCover(1)).toBe(0);
	});

	test('linear across the thread enter/exit slide', () => {
		// Forward enter: threadCoverProgress 0 -> 1, list foreground 1 -> 0
		// (scale crosses 0.5 at threadCoverProgress 0.5, first-half disappear).
		expect(listForegroundFromThreadCover(0.25)).toBe(0.75);
		expect(listForegroundFromThreadCover(0.5)).toBe(0.5);
		expect(listForegroundFromThreadCover(0.75)).toBe(0.25);
	});

	test('clamps beyond [0, 1]', () => {
		expect(listForegroundFromThreadCover(1.5)).toBe(0);
		expect(listForegroundFromThreadCover(-0.5)).toBe(1);
	});

	test('Family B forward enter yields scale 1 -> 0 across the slide', () => {
		// At slide start the list is foreground (scale 1); at slide end the
		// thread covers it (scale 0). The composed scale crosses 0.5 when the
		// list foreground drops below 0.75 (scaleFromFraction(0.75) = 0.5).
		expect(scaleFromFraction(listForegroundFromThreadCover(0))).toBe(1);
		expect(scaleFromFraction(listForegroundFromThreadCover(0.5))).toBe(0);
		expect(scaleFromFraction(listForegroundFromThreadCover(1))).toBe(0);
	});
});

describe('familyNeedsSamplerDuringDrag', () => {
	test('Family A (list) -> false (live fractionalIndex drives the drag)', () => {
		expect(familyNeedsSamplerDuringDrag('list')).toBe(false);
	});

	test('Family B (overlay) -> true (thread route pins fractionalIndex at centerTab)', () => {
		expect(familyNeedsSamplerDuringDrag('overlay')).toBe(true);
	});

	test('Family C (compose) -> false (no sibling track to sample)', () => {
		expect(familyNeedsSamplerDuringDrag('compose')).toBe(false);
	});

	test('only the overlay family is sampler-driven during drag', () => {
		const families = ['list', 'overlay', 'compose'] as const;
		const samplerDriven = families.filter(familyNeedsSamplerDuringDrag);
		expect(samplerDriven).toEqual(['overlay']);
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
		// translateY is clamped to [-headerHeight, 0] by scroll-chrome, but the
		// function is defensive against out-of-range inputs.
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
