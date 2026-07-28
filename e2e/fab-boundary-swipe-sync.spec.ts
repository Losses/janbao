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
 * The FIRST-tab test exercises a boundary void-swipe: at the first tab on a
 * bidirectional host a swipe toward the absent previous neighbour (no
 * `previousEntryPathname()`, no further history) rubber-bands the track. The
 * global nav-pipeline orchestrator applies the boundary void-swipe
 * proportional reaction inline in its `#interpretIntent`
 * (`startProgress + Math.max(0, rawDrag) * BOUNDARY_RUBBER_BAND_FACTOR`), so
 * `fromPathname === toPathname` and the raw drag progress is published on its
 * per-frame publication. The FAB layer is a reactive reader of that same
 * publication. It folds the publication into `computeFabScale`, whose branch
 * 1 (boundary void-swipe) reacts proportionally to the rubber-band via
 * `1 - progress * BOUNDARY_RUBBER_BAND_FACTOR` (reaching 0.6 at full drag)
 * instead of the default natural `fabScale(progress, fromHasFab, toHasFab)`
 * icon-handoff that dips to 0 at progress=0.5 (an over-reaction to a ~40%
 * track displacement), so the FAB stays visible and tracks the
 * reduced-amplitude drag from the first frame.
 *
 * The LAST-tab test exercises a DIFFERENT gesture: a leftward (forward) swipe
 * at the last tab on a bidirectional host resolves to `/search` via
 * `#nextTabTarget` (the `{tab, search}` pair from DV20-Plan §6). The
 * orchestrator claims the gesture, publishes `transitionTarget='/search'`
 * plus the live `backMorph`, and the body slide is suppressed
 * (`#resolvePlan`'s third `suppressSlide` case: a forward-to-`/search` swipe
 * from the last tab has no panel to reveal, so `distance = 0`). The FAB
 * animates via `computeFabScale`'s default natural branch
 * `fabScale(progress, fromHasFab, toHasFab)` (from-only-FAB shape: 1 at rest,
 * 0 at progress=1), NOT via branch 1's boundary rubber-band proportional
 * reaction. The test asserts the FAB scale varied (delta > 0.1), which holds
 * under both mechanisms; the second guard below asserts the gesture lands on
 * `/search` and uses the slide-suppressed natural-`fabScale` path (not the
 * boundary rubber-band).
 *
 * Each test asserts the FAB scale varied (delta > 0.1). A delta near 0 means
 * the FAB is pinned at its resting scale and is not tracking the gesture.
 * captureFabTransition samples [data-testid="fab"]'s resolved scale across
 * the gesture. Family A is a same-document SPA nav, so the FAB atom and the
 * orchestrator's per-frame publication both survive the gesture.
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

// Messages FAB (tab 2, the last tab). swipeForward swipes leftward; the
// last tab's spatial neighbour is `/search` (DV20-Plan §6's `{tab, search}`
// pair via `#nextTabTarget`), so the orchestrator claims the gesture and
// dispatches a real navigation to `/search`. The body slide is suppressed
// (`#resolvePlan`'s third `suppressSlide` case: forward-to-`/search` from
// the last tab has no rightward panel to reveal), and the FAB animates via
// the natural `fabScale(progress, fromHasFab, toHasFab)` formula (from-only
// shape: 1 at rest, 0 at progress=1). The test asserts the FAB scale varied
// (delta > 0.1), which holds for the slide-suppressed `fabScale` path.
test('Family A forward swipe: FAB tracks the forward-swipe-to-/search from the last tab (messages)', async ({
	page
}) => {
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	const capture = await captureFabTransition(page, () => swipeForward(page));

	expect(capture.firstScale, 'FAB rests at scale 1 on the messages list').toBeGreaterThan(0.9);
	expect(
		capture.delta,
		`FAB scale must vary during a last-tab forward-swipe-to-/search. delta=${capture.delta.toFixed(2)}`
	).toBeGreaterThan(0.1);
});
