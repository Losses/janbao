import { test, expect } from '@playwright/test';
import {
	prepareContext,
	waitForHydration,
	captureFabTransition,
	swipeForward,
	swipeBack
} from './helpers';

/**
 * Preventive regression spec for FAB boundary-swipe sync (Family A).
 *
 * At the FIRST and LAST tab, a swipe toward the boundary with no neighbour (a
 * void swipe) rubber-bands the track: follow() applies a 0.4x factor, so the
 * MobileTabPager publishes a fractionalIndex briefly outside [0,2]. The
 * MobileTabBar pill tracks that motion live, since its closeness reads the
 * unclamped fractionalIndex. The FAB's Family A sampler must track the same
 * motion: sampleFraction returns the raw -m41 / panelWidth with no input
 * clamp, and tabFraction clamps only the OUTPUT to [0,1]. The FAB's
 * foregroundFraction therefore equals the pill's closeness frame for frame,
 * and a boundary void-swipe dips the FAB along with the pill.
 *
 * Each test drives a void-swipe at one boundary and asserts the FAB scale
 * varied (delta > 0.1). A delta near 0 means the FAB is pinned at its resting
 * scale and is not tracking the boundary rubber-band. captureFabTransition
 * samples [data-testid="fab"]'s resolved scale across the gesture. Family A is
 * a same-document SPA nav, so the FAB atom and its sampler both survive the
 * non-committing void-swipe.
 */

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

// Discussions FAB (tab 0, the first tab). swipeBack swipes rightward toward the
// non-existent previous tab, so the track rubber-bands. On a fresh landing
// previousEntryPathname() is null (no history entry behind the current tab),
// so the backward gesture has no target and the gesture is a boundary
// void-swipe (no navigation).
test('Family A boundary: FAB tracks the void-swipe rubber-band on the first tab (discussions)', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	const capture = await captureFabTransition(page, () => swipeBack(page));

	expect(capture.firstScale, 'FAB rests at scale 1 on the discussions list').toBeGreaterThan(0.9);
	expect(
		capture.delta,
		`FAB scale must vary during a first-tab void-swipe. delta=${capture.delta.toFixed(2)}`
	).toBeGreaterThan(0.1);
});

// Messages FAB (tab 2, the last tab). swipeForward swipes leftward toward the
// non-existent next tab. Leftward swipes always take the follow() branch (the
// back-chip check is rightward-only), so this is the clean boundary case.
// Symmetric guard against a fix that lands the tracking on one end only.
test('Family A boundary: FAB tracks the void-swipe rubber-band on the last tab (messages)', async ({
	page
}) => {
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	const capture = await captureFabTransition(page, () => swipeForward(page));

	expect(capture.firstScale, 'FAB rests at scale 1 on the messages list').toBeGreaterThan(0.9);
	expect(
		capture.delta,
		`FAB scale must vary during a last-tab void-swipe. delta=${capture.delta.toFixed(2)}`
	).toBeGreaterThan(0.1);
});
