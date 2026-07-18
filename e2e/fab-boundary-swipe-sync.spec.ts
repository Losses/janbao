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
 * global nav-pipeline orchestrator publishes `fromPathname === toPathname`
 * with the raw drag progress on its per-frame publication. The FAB layer is a
 * reactive reader of that same publication. On a real transition it computes
 * `fabScale(publication.progress, fromHasFab, toHasFab)`, the icon-handoff
 * half-mapping that dips to 0 at progress=0.5, but on a boundary void-swipe
 * (the very condition this spec exercises) the FAB does NOT use `fabScale`;
 * it reacts proportionally to the rubber-band via
 * `1 - progress * BOUNDARY_RUBBER_BAND_FACTOR` (reaching 0.6 at full drag),
 * so the FAB stays visible and tracks the reduced-amplitude drag from the
 * first frame.
 *
 * Each test drives a void-swipe at one boundary and asserts the FAB scale
 * varied (delta > 0.1). A delta near 0 means the FAB is pinned at its resting
 * scale and is not tracking the boundary rubber-band. captureFabTransition
 * samples [data-testid="fab"]'s resolved scale across the gesture. Family A is
 * a same-document SPA nav, so the FAB atom and the orchestrator's per-frame
 * publication both survive the non-committing void-swipe.
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
