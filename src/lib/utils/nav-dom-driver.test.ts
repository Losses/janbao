// src/lib/utils/nav-dom-driver.test.ts
/**
 * Unit suite for `MockNavDomDriver`. The mock is the test double used
 * by the executor-logic suite; this suite verifies its recording
 * semantics so the executor suite can rely on them without
 * re-asserting. The production driver `LiveNavDomDriver` is covered by
 * `nav-dom-driver-live.test.ts`.
 */

import { describe, test, expect } from 'bun:test';
import { MockNavDomDriver, type NavVisualWrite } from './nav-dom-driver';

function sampleVisual(translateX: number): NavVisualWrite {
	return {
		pageTrack: { translateX }
	};
}

describe('MockNavDomDriver', () => {
	test('default reduced-motion flag is false', () => {
		const driver = new MockNavDomDriver();
		expect(driver.prefersReducedMotion()).toBe(false);
	});

	test('reduced-motion flag is configurable via the constructor', () => {
		const driver = new MockNavDomDriver({ reducedMotion: true });
		expect(driver.prefersReducedMotion()).toBe(true);
	});

	test('setReducedMotion flips the flag mid-test', () => {
		const driver = new MockNavDomDriver();
		expect(driver.prefersReducedMotion()).toBe(false);
		driver.setReducedMotion(true);
		expect(driver.prefersReducedMotion()).toBe(true);
		driver.setReducedMotion(false);
		expect(driver.prefersReducedMotion()).toBe(false);
	});

	test('write records every visual in order', () => {
		const driver = new MockNavDomDriver();
		driver.write(sampleVisual(0));
		driver.write(sampleVisual(-100));
		driver.write(sampleVisual(-200));
		expect(driver.writes.length).toBe(3);
		expect(driver.writes[0].pageTrack.translateX).toBe(0);
		expect(driver.writes[1].pageTrack.translateX).toBe(-100);
		expect(driver.writes[2].pageTrack.translateX).toBe(-200);
	});

	test('lastWrite returns the most recent write', () => {
		const driver = new MockNavDomDriver();
		expect(driver.lastWrite).toBeUndefined();
		driver.write(sampleVisual(0));
		driver.write(sampleVisual(-50));
		expect(driver.lastWrite?.pageTrack.translateX).toBe(-50);
	});

	test('lastWrite returns undefined when the driver has been cleared', () => {
		const driver = new MockNavDomDriver();
		driver.write(sampleVisual(0));
		driver.clear();
		expect(driver.writes.length).toBe(0);
		expect(driver.lastWrite).toBeUndefined();
	});

	test('clear drops the recorded writes but keeps the reduced-motion flag', () => {
		const driver = new MockNavDomDriver({ reducedMotion: true });
		driver.write(sampleVisual(0));
		driver.clear();
		expect(driver.writes.length).toBe(0);
		expect(driver.prefersReducedMotion()).toBe(true);
	});
});
