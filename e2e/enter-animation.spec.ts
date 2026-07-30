import { test, expect } from '@playwright/test';
import {
	prepareContext,
	waitForHydration,
	captureEnterAnimation,
	clickDiscussion,
	type EnterAnimCapture
} from './helpers';

/**
 * Thread enter-animation regression coverage.
 *
 * NavPipelineHost's orchestrator.playEnterAnimation plays a list→thread
 * slide-in (track seeded at translateX(0px) and slid to its resting
 * translateX(-33.333%) over ~300ms on the 3-panel-wide track) only when the
 * `shouldEnter` $derived.by gate passes: `navStore.direction === 'forward'`
 * AND the stack's previous pathname === resolvedLeftHref (the resolved left
 * href for a thread is the discussions list root). A tab-bar tap that returns
 * to the list goes through switchTab; if that leaves a stale thread entry in
 * the tab's nav stack, the NEXT list→thread push sees a previous pathname that
 * is the stale thread, not the resolved left href, so the `shouldEnter`
 * precondition fails and the slide-in is silently suppressed. These tests
 * sample the track's translateX to prove the animation actually ran.
 *
 * Faithfulness note: the tab-tap return MUST be a real click on
 * `a[data-tab-nav]` (the switchTab path). A `goto('/ ')` would route through
 * handleBeforeNavigate instead and not reproduce the bug.
 */

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

// CALIBRATION: prove the sampler detects the slide-in on a clean first visit.
// If this fails, the harness (viewport / selector / sampler) is broken - do not
// trust the regression test below.
test('CALIBRATION: first list→thread enter animates the track', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	const anim = await captureEnterAnimation(page, () => clickDiscussion(page, 0));
	await page.waitForURL(/\/discussion\//);
	expect(anim.sampleCount, 'sampler must have captured frames').toBeGreaterThan(5);
	expect(anim.delta, 'track must translate ≈ one viewport during the slide-in').toBeGreaterThan(100);
	expect(anim.animated).toBe(true);
});

// REGRESSION: after returning to the list via a tab-bar tap, entering a DIFFERENT
// discussion must still animate. Pre-fix: switchTab left the prior thread in the
// stack → prevPathMismatch → track born centred, delta 0, no animation.
test('REGRESSION: enter still animates after a tab-tap return to the list', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);

	// 1. Enter thread A (index 0) - establishes a thread entry in tab 0's stack.
	await captureEnterAnimation(page, () => clickDiscussion(page, 0));
	await page.waitForURL(/\/discussion\//);

	// 2. Return to the list via the Discussions TAB (data-tab-nav → switchTab).
	await page.locator('a[data-tab-nav][href="/"]').click();
	await page.waitForURL('/');

	// 3. Enter a DIFFERENT discussion (index 1) - must still slide in.
	const anim: EnterAnimCapture = await captureEnterAnimation(page, () =>
		clickDiscussion(page, 1)
	);
	expect(
		anim.delta,
		'enter animation regressed: stale stack entry suppressed the slide-in (track never moved)'
	).toBeGreaterThan(100);
	expect(anim.animated).toBe(true);
});

// REGRESSION variant: the trigger is "any tab" per the report. Tapping Activity
// then Discussions must also leave the list clean for the next enter.
test('REGRESSION: enter still animates after visiting another tab and returning', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);

	await captureEnterAnimation(page, () => clickDiscussion(page, 0));
	await page.waitForURL(/\/discussion\//);

	// Detour through Activity, then back to the Discussions tab.
	await page.locator('a[data-tab-nav][href="/activity"]').click();
	await page.waitForURL('/activity');
	await page.locator('a[data-tab-nav][href="/"]').click();
	await page.waitForURL('/');

	const anim = await captureEnterAnimation(page, () => clickDiscussion(page, 1));
	expect(anim.delta, 'enter animation regressed after an Activity-tab detour').toBeGreaterThan(100);
	expect(anim.animated).toBe(true);
});
