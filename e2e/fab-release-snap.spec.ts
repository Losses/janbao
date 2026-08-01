import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

/**
 * FAB release-snap jump (Family A) - reproduction spec.
 *
 * Symptom: during a tab-swipe drag the FAB scale tracks the finger 1:1 (the live
 * `publication.progress` drives it), but the moment the finger lifts the scale
 * LEAPS to its resting endpoint in a single frame instead of easing across
 * the ~300ms release settle. The FAB
 * "pops" while the panels are still sliding.
 *
 * This spec isolates the RELEASE window (the existing fab.spec.ts trajectory
 * tests sample the whole gesture and mask this jump with a 0.25 tolerance plus
 * trailing/leading trims, so a 130px partial swipe - whose scale is still
 * mid-range at lift-off - passes there despite the pop). Here the swipe distance
 * is tuned so the FAB is provably mid-scale at release, and the assertion
 * demands the snap actually EASE through the intermediate band rather than jump.
 *
 * Family A is a same-document SPA nav (the (tabs) layout stays mounted, so the
 * FAB atom and the sampler both survive), so a plain in-page rAF sampler over
 * the resolved `transform` matrix suffices.
 */

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

/** One resolved-scale sample tagged with the rAF time (ms). */
interface ScaleSample {
	t: number;
	scale: number;
}

interface TrajectoryCapture {
	samples: ScaleSample[];
	finiteScales: number[];
	minScale: number;
	maxScale: number;
}

/**
 * Drive a purely-horizontal CDP touch swipe of an exact pixel distance (detectSwipe
 * rejects pointerType 'mouse'; CDP synthesises the touch PointerEvents it accepts).
 * `distance > 0` swipes left (forward to the next tab); `< 0` swipes right (back).
 */
async function swipeExact(page: import('@playwright/test').Page, distance: number): Promise<void> {
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.7);
	const endX = startX - distance;
	const y = 400;
	const steps = 14;
	const dispatch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, state: string) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});
	await dispatch('touchStart', startX, 'touchPressed');
	for (let i = 1; i <= steps; i++) {
		const x = Math.round(startX + (endX - startX) * (i / steps));
		await dispatch('touchMove', x, 'touchMoved');
	}
	await dispatch('touchEnd', endX, 'touchReleased');
	await client.detach();
}

/**
 * Install a continuous rAF sampler over the FAB's resolved `transform` (the
 * matrix `a` component === scale, since the atom's transform is a single
 * `scale(s) translateY(y)`), trigger a gesture, hold a capture window open past
 * the 300ms snap, then return the trajectory.
 */
async function captureFabScale(
	page: import('@playwright/test').Page,
	trigger: () => Promise<void>,
	windowMs = 900
): Promise<TrajectoryCapture> {
	await page.evaluate(() => {
		const w = window as unknown as { __fabRel?: { samples: ScaleSample[] } };
		w.__fabRel = { samples: [] };
		const tick = (): void => {
			const state = (window as unknown as { __fabRel?: { samples: ScaleSample[] } }).__fabRel;
			if (state) {
				const fab = document.querySelector('[data-testid="fab"]') as HTMLElement | null;
				let scale = NaN;
				if (fab) {
					const m = getComputedStyle(fab).transform || '';
					const paren = m.match(/matrix(?:3d)?\(([^)]+)\)/);
					if (paren) {
						const a = Number(paren[1].split(',')[0].trim());
						if (!Number.isNaN(a)) scale = a;
					} else if (m === 'none') {
						scale = 0;
					}
				}
				state.samples.push({ t: performance.now(), scale });
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	await page.waitForTimeout(120);
	await trigger();
	await page.waitForTimeout(windowMs);
	const raw = await page.evaluate(() => {
		const w = window as unknown as { __fabRel?: { samples: ScaleSample[] } };
		return w.__fabRel?.samples ?? [];
	});
	const finiteScales = raw.map((s) => s.scale).filter((s): s is number => Number.isFinite(s));
	return {
		samples: raw,
		finiteScales,
		minScale: finiteScales.length ? Math.min(...finiteScales) : NaN,
		maxScale: finiteScales.length ? Math.max(...finiteScales) : NaN
	};
}

/**
 * Assert the release scaled SMOOTHLY using two deterministic guards (neither
 * depends on rAF sample timing: rAF timestamps can compress multiple FAB
 * publications into a few-ms window under main-thread pressure):
 *   1. INTERMEDIATE-PUBLICATIONS check: between the LAST sample above `hi` and
 *      the FIRST subsequent sample at or below `lo`, the FAB scale must take at
 *      least `MIN_INTERMEDIATES` distinct intermediate values. A one-frame pop
 *      (e.g. 0.39 -> 0.00) publishes ZERO intermediate values; a correct ease
 *      publishes at least one (the FAB scale lerps off
 *      `settleMorphFraction` during the release settle; `commitEase`'s
 *      per-frame advance publishes at least one intermediate under
 *      normal main-thread load).
 *   2. LEAP check: no single captured frame may leap from above `gapHi` to
 *      below `gapLo` with magnitude >= 0.2. A pop (e.g. 0.39 -> 0.00)
 *      registers a ~0.39 drop, well over the threshold; a correct ease produces
 *      successive samples close enough that no step approaches it.
 * Both guards are wall-clock-independent: the route-navigation main-thread
 * block can compress the rAF timestamps of consecutive FAB publications, so the
 * assertion must not depend on wall-clock span.
 */
function assertSmoothRelease(
	capture: TrajectoryCapture,
	lo: number,
	hi: number,
	gapHi: number,
	gapLo: number
): void {
	// Guard 1: intermediate-publications. A one-frame pop publishes ZERO
	// intermediate scale values between the > hi sample and the <= lo sample;
	// a correct ease publishes at least MIN_INTERMEDIATES distinct values in
	// the (lo, hi] band. This is wall-clock-independent (counts FAB
	// publications, not rAF ticks), so main-thread rAF compression cannot
	// flake it.
	const MIN_INTERMEDIATES = 1;
	let lastHighIdx = -1;
	for (let i = 0; i < capture.samples.length; i++) {
		if (capture.samples[i].scale > hi) lastHighIdx = i;
	}
	let firstLowIdx = -1;
	if (lastHighIdx >= 0) {
		for (let i = lastHighIdx + 1; i < capture.samples.length; i++) {
			if (capture.samples[i].scale <= lo) {
				firstLowIdx = i;
				break;
			}
		}
	}
	const intermediateValues = new Set<number>();
	if (lastHighIdx >= 0 && firstLowIdx > lastHighIdx) {
		for (let i = lastHighIdx + 1; i < firstLowIdx; i++) {
			const s = capture.samples[i].scale;
			if (Number.isFinite(s)) intermediateValues.add(s);
		}
	}
	expect(
		intermediateValues.size,
		`release must publish at least ${MIN_INTERMEDIATES} intermediate scale value(s) between >${hi} and <=${lo} (a one-frame pop publishes zero). intermediates=${[...intermediateValues].map((s) => s.toFixed(2)).join(',')} scales=[${capture.finiteScales
			.map((s) => s.toFixed(2))
			.join(',')}]`
	).toBeGreaterThanOrEqual(MIN_INTERMEDIATES);

	// Guard 2: leap check. No single captured frame may leap from above `gapHi`
	// to below `gapLo`. A one-frame pop (0.39 -> 0.00) registers a ~0.39
	// single-frame drop, which exceeds the 0.2 threshold; a correct ease
	// produces successive samples close enough that no step approaches it.
	let leap = 0;
	for (let i = 1; i < capture.finiteScales.length; i++) {
		const prev = capture.finiteScales[i - 1];
		const curr = capture.finiteScales[i];
		if (prev > gapHi && curr < gapLo) {
			leap = Math.max(leap, prev - curr);
		}
	}
	expect(
		leap,
		`no single frame may leap from >${gapHi} to <${gapLo} on release (got a ${leap.toFixed(2)} single-frame drop). scales=[${capture.finiteScales
			.map((s) => s.toFixed(2))
			.join(',')}]`
	).toBeLessThan(0.2);
}

// Discussions FAB (tab 0), forward commit to Activity. The distance is 30.5% of
// the viewport (120px on a 393px Pixel 5): it clears the 60px commit threshold but
// stops the drag at publication.progress 0.305, i.e. scale 0.389 (> 0.30) invariant
// across viewport widths, so the drag itself never enters the (0.05, 0.30) easing
// band. The release must ease 0.39 down to 0 across the 300ms snap; a one-frame
// pop to 0 is the failure.
test('Family A forward: FAB eases out across the release snap (discussions -> activity)', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	const width = page.viewportSize()?.width ?? 393;
	const commitDist = Math.round(width * 0.305);
	const capture = await captureFabScale(page, () => swipeExact(page, commitDist));

	// Precondition: the FAB really did scale out during the drag and reached
	// near-0 by the end of the window (the swipe committed). Without these the
	// release assertion could pass vacuously (no descent to measure, no leap).
	expect(capture.maxScale, 'FAB must start at scale 1 on the discussions list').toBeGreaterThan(0.9);
	expect(capture.minScale, 'FAB must reach near-0 once the swipe commits').toBeLessThan(0.1);

	assertSmoothRelease(capture, 0.05, 0.3, 0.2, 0.05);
});

// Messages FAB (tab 2), backward commit to Activity. The symmetric case on the
// other FAB-bearing tab and the opposite swipe direction, guarding against a fix
// that lands the easing on the discussions tab only.
test('Family A backward: FAB eases out across the release snap (messages -> activity)', async ({
	page
}) => {
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	const width = page.viewportSize()?.width ?? 393;
	const commitDist = Math.round(width * 0.305);
	// distance < 0 => rightward swipe => back to the previous tab (activity).
	const capture = await captureFabScale(page, () => swipeExact(page, -commitDist));

	expect(capture.maxScale, 'FAB must start at scale 1 on the messages list').toBeGreaterThan(0.9);
	expect(capture.minScale, 'FAB must reach near-0 once the swipe commits').toBeLessThan(0.1);

	assertSmoothRelease(capture, 0.05, 0.3, 0.2, 0.05);
});

/**
 * Assert a scale-IN release (a cancelled swipe snapping back to its source tab)
 * eased smoothly. The FAB scaled down during the drag (minScale < 0.9) and
 * returned to rest (maxScale > 0.95), and no single frame leapt up from <0.90
 * to >0.95. A smooth ease crosses 0.95 starting from ~0.93 (prev > 0.90); the
 * bug jumps from the drag value (<0.90) straight to 1.0 in one frame. The
 * scale-IN case needs only this single-frame upward leap check: the drag
 * already traversed (0.75, 0.95) on the way down, so the upward leap alone
 * distinguishes a pop from an ease.
 */
function assertSmoothScaleIn(capture: TrajectoryCapture): void {
	expect(capture.minScale, 'drag must scale the FAB below 0.9').toBeLessThan(0.9);
	expect(capture.maxScale, 'cancel must return the FAB to near 1').toBeGreaterThan(0.95);
	let leap = 0;
	for (let i = 1; i < capture.finiteScales.length; i++) {
		const prev = capture.finiteScales[i - 1];
		const curr = capture.finiteScales[i];
		if (prev < 0.9 && curr > 0.95) {
			leap = Math.max(leap, curr - prev);
		}
	}
	expect(
		leap,
		`no single frame may leap from <0.90 to >0.95 on a cancel (got a ${leap.toFixed(2)} single-frame rise). scales=[${capture.finiteScales
			.map((s) => s.toFixed(2))
			.join(',')}]`
	).toBeLessThan(0.2);
}

// Family A cancel: a sub-threshold swipe (50px, under the 60px SWIPE_COMMIT line)
// snaps back to the source tab. The FAB scaled DOWN during the drag (to about
// 0.69-0.77 across phone widths) and must ease back up to 1 across the 300ms snap;
// the bug pops it back to 1 in one frame. Covers the scale-IN manifestation, which
// the two commit tests (scale out to 0) do not exercise.
test('Family A cancel: FAB eases back in across the release snap (discussions snap-back)', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	const capture = await captureFabScale(page, () => swipeExact(page, 50));

	assertSmoothScaleIn(capture);
});
