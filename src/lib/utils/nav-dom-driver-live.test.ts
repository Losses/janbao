// src/lib/utils/nav-dom-driver-live.test.ts
/**
 * Unit suite for the production `NavDomDriver` (`LiveNavDomDriver`,
 * constructed by `nav-pipeline-orchestrator.svelte.ts`). The driver is
 * tested with stub elements (plain objects whose `style` is a
 * capturing bag) and an injectable element-resolver / matchMedia, so
 * no real DOM is required.
 *
 * Coverage:
 *  - Write mapping: axis/progress -> translateX sign + magnitude.
 *  - Null-element skip (the driver does not throw when the page-track
 *    element is not yet bound).
 *  - The element resolver is called each `write` so a re-bound
 *    reference is picked up automatically.
 *  - Reduced-motion read: matchMedia receives the exact query string
 *    `(prefers-reduced-motion: reduce)`; the `matches` value flows
 *    through unchanged.
 *  - Default matchMedia: callable in a runtime without `window` (the
 *    bun runtime under `bun:test`), returns `{ matches: false }`.
 */

import { describe, test, expect } from 'bun:test';
import { LiveNavDomDriver, REDUCED_MOTION_QUERY, type DriverElement } from './nav-dom-driver-live';
import type { NavVisualWrite } from './nav-dom-driver';

// ---------------------------------------------------------------------------
// Capturing stub element. Mirrors the structural `DriverElement` shape
// (a `style` with a `setProperty` method) so the driver writes through
// it without any real DOM. The capture map lets assertions read back
// every write by exact key.

class CapturingStyle {
	readonly captured = new Map<string, string>();
	setProperty(key: string, value: string): void {
		this.captured.set(key, value);
	}
	get(key: string): string | undefined {
		return this.captured.get(key);
	}
}

class CapturingElement implements DriverElement {
	readonly style = new CapturingStyle();
}

interface ElementBag {
	pageTrack: CapturingElement | null;
}

function makeElements(overrides?: Partial<ElementBag>): ElementBag {
	const pageTrack = overrides?.pageTrack === undefined ? null : overrides.pageTrack;
	return { pageTrack };
}

interface SampleVisualOverrides {
	readonly translateX?: number;
}

function sampleVisual(overrides?: SampleVisualOverrides): NavVisualWrite {
	const o = overrides ?? {};
	return {
		pageTrack: { translateX: o.translateX ?? 0 }
	};
}

// ---------------------------------------------------------------------------
// write: page-track translateX sign + magnitude.

describe('LiveNavDomDriver.write: page-track translateX', () => {
	test('negative translateX preserves the sign (axis = left, mid-progress)', () => {
		const el = new CapturingElement();
		const driver = new LiveNavDomDriver({
			resolveElements: () => makeElements({ pageTrack: el })
		});
		driver.write(sampleVisual({ translateX: -100 }));
		expect(el.style.get('transform')).toBe('translateX(-100px)');
	});

	test('positive translateX preserves the sign (axis = right, mid-progress)', () => {
		const el = new CapturingElement();
		const driver = new LiveNavDomDriver({
			resolveElements: () => makeElements({ pageTrack: el })
		});
		driver.write(sampleVisual({ translateX: 50 }));
		expect(el.style.get('transform')).toBe('translateX(50px)');
	});

	test('zero translateX writes translateX(0px)', () => {
		const el = new CapturingElement();
		const driver = new LiveNavDomDriver({
			resolveElements: () => makeElements({ pageTrack: el })
		});
		driver.write(sampleVisual({ translateX: 0 }));
		expect(el.style.get('transform')).toBe('translateX(0px)');
	});

	test('fractional magnitude is preserved', () => {
		const el = new CapturingElement();
		const driver = new LiveNavDomDriver({
			resolveElements: () => makeElements({ pageTrack: el })
		});
		driver.write(sampleVisual({ translateX: -123.456 }));
		expect(el.style.get('transform')).toBe('translateX(-123.456px)');
	});

	test('axis -> sign chain end-to-end: axis=left, distance=200, progress=0.5', () => {
		// Mirrors the executor's `buildVisual` computation, verified
		// through the driver. axis='left' produces a negative translateX;
		// magnitude = distance * progress. The driver applies the signed
		// value as given by the executor.
		const el = new CapturingElement();
		const driver = new LiveNavDomDriver({
			resolveElements: () => makeElements({ pageTrack: el })
		});
		const sign = -1; // axis='left' (per `PageTrackAxis` in nav-resolvers.ts)
		const distance = 200;
		const progress = 0.5;
		const translateX = sign * distance * progress;
		driver.write(sampleVisual({ translateX }));
		expect(el.style.get('transform')).toBe('translateX(-100px)');
	});

	test('axis -> sign chain end-to-end: axis=right, distance=300, progress=0.25', () => {
		const el = new CapturingElement();
		const driver = new LiveNavDomDriver({
			resolveElements: () => makeElements({ pageTrack: el })
		});
		const sign = 1; // axis='right'
		const distance = 300;
		const progress = 0.25;
		const translateX = sign * distance * progress;
		driver.write(sampleVisual({ translateX }));
		expect(el.style.get('transform')).toBe('translateX(75px)');
	});
});

// ---------------------------------------------------------------------------
// write: null-element handling + resolver behavior.

describe('LiveNavDomDriver.write: resolver and null handling', () => {
	test('a null page-track element is skipped without throwing', () => {
		const driver = new LiveNavDomDriver({
			resolveElements: () => makeElements({ pageTrack: null })
		});
		expect(() => driver.write(sampleVisual())).not.toThrow();
	});

	test('default resolver return (no overrides) is pageTrack null', () => {
		// Verifies the `makeElements` helper's default shape so the
		// null-skip test above is unambiguous.
		const els = makeElements();
		expect(els.pageTrack).toBeNull();
	});

	test('the element resolver is called each write', () => {
		let callCount = 0;
		const el = new CapturingElement();
		const driver = new LiveNavDomDriver({
			resolveElements: () => {
				callCount += 1;
				return makeElements({ pageTrack: el });
			}
		});
		driver.write(sampleVisual());
		driver.write(sampleVisual());
		driver.write(sampleVisual());
		expect(callCount).toBe(3);
	});

	test('a fresh element per write is honored (re-bind scenario)', () => {
		// Models a re-bound `bind:this` reference: the resolver returns
		// element A on the first write and element B on the second.
		const el1 = new CapturingElement();
		const el2 = new CapturingElement();
		let current = el1;
		const driver = new LiveNavDomDriver({
			resolveElements: () => makeElements({ pageTrack: current })
		});
		driver.write(sampleVisual({ translateX: 10 }));
		current = el2;
		driver.write(sampleVisual({ translateX: 20 }));
		expect(el1.style.get('transform')).toBe('translateX(10px)');
		expect(el2.style.get('transform')).toBe('translateX(20px)');
	});

	test('a partial bind (pageTrack only) writes the pageTrack and skips the others', () => {
		const pageTrack = new CapturingElement();
		const driver = new LiveNavDomDriver({
			resolveElements: () => makeElements({ pageTrack })
		});
		expect(() => driver.write(sampleVisual({ translateX: 5 }))).not.toThrow();
		expect(pageTrack.style.get('transform')).toBe('translateX(5px)');
	});
});

// ---------------------------------------------------------------------------
// prefersReducedMotion.

describe('LiveNavDomDriver.prefersReducedMotion', () => {
	test('returns true when matchMedia reports matches = true', () => {
		const driver = new LiveNavDomDriver({
			resolveElements: () => makeElements(),
			matchMedia: () => ({ matches: true })
		});
		expect(driver.prefersReducedMotion()).toBe(true);
	});

	test('returns false when matchMedia reports matches = false', () => {
		const driver = new LiveNavDomDriver({
			resolveElements: () => makeElements(),
			matchMedia: () => ({ matches: false })
		});
		expect(driver.prefersReducedMotion()).toBe(false);
	});

	test('passes the reduced-motion query string to matchMedia', () => {
		let captured = '';
		const driver = new LiveNavDomDriver({
			resolveElements: () => makeElements(),
			matchMedia: (query) => {
				captured = query;
				return { matches: false };
			}
		});
		driver.prefersReducedMotion();
		expect(captured).toBe(REDUCED_MOTION_QUERY);
		expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)');
	});

	test('REDUCED_MOTION_QUERY constant is the canonical query string', () => {
		// Pinning test: the constant is the source of truth the driver
		// passes to matchMedia. A typo here would silently disable the
		// reduced-motion snap path.
		expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)');
	});

	test('default matchMedia: callable without window (SSR / bun runtime)', () => {
		// The default matchMedia returns `{ matches: false }` when
		// `window` is undefined. The bun:test runtime does not define
		// `window`, so this exercises the SSR fallback branch directly.
		const driver = new LiveNavDomDriver({
			resolveElements: () => makeElements()
		});
		expect(() => driver.prefersReducedMotion()).not.toThrow();
		expect(driver.prefersReducedMotion()).toBe(false);
	});

	test('default matchMedia idempotent across calls', () => {
		const driver = new LiveNavDomDriver({
			resolveElements: () => makeElements()
		});
		const first = driver.prefersReducedMotion();
		const second = driver.prefersReducedMotion();
		expect(first).toBe(second);
	});
});
