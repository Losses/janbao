import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

/**
 * FAB release-snap jump (Family A) - reproduction spec.
 *
 * Symptom: during a tab-swipe drag the FAB scale tracks the finger 1:1 (the live
 * `pager.fractionalIndex` drives it), but the moment the finger lifts the scale
 * LEAPS to its resting endpoint in a single frame instead of easing across the
 * pager's 200ms CSS snap like the track itself does. The FAB "pops" while the
 * panels are still sliding.
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
 * the 200ms snap, then return the trajectory.
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
 * Assert the release scaled SMOOTHLY: the snap must ease through the intermediate
 * band (several frames strictly between `lo` and `hi`), and no single frame may
 * leap across the release gap (from above `gapHi` to below `gapLo` in one rAF).
 * A single-frame jump fails both: it skips the band and is itself the leap.
 */
function assertSmoothRelease(
	capture: TrajectoryCapture,
	lo: number,
	hi: number,
	gapHi: number,
	gapLo: number
): void {
	const inBand = capture.finiteScales.filter((s) => s > lo && s < hi);
	expect(
		inBand.length,
		`release must ease through the (${lo}, ${hi}) band with several frames; a single-frame jump skips it. scales=[${capture.finiteScales
			.map((s) => s.toFixed(2))
			.join(',')}]`
	).toBeGreaterThanOrEqual(3);
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

// Discussions FAB (tab 0), forward commit to Activity. A 120px swipe clears the
// 60px commit threshold but stops the drag at scale ≈ 0.39 (> 0.30), so the drag
// itself never enters the (0.05, 0.30) easing band - only a smooth release snap
// would populate it. The release must ease 0.39 → 0 across the 200ms snap instead
// of popping there in one frame.
test('Family A forward: FAB eases out across the release snap (discussions -> activity)', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	const capture = await captureFabScale(page, () => swipeExact(page, 120));

	// Precondition: the FAB really did scale out during the drag and reached
	// near-0 by the end of the window (the swipe committed). Without these the
	// easing-band assertion could pass vacuously.
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

	// distance < 0 => rightward swipe => back to the previous tab (activity).
	const capture = await captureFabScale(page, () => swipeExact(page, -120));

	expect(capture.maxScale, 'FAB must start at scale 1 on the messages list').toBeGreaterThan(0.9);
	expect(capture.minScale, 'FAB must reach near-0 once the swipe commits').toBeLessThan(0.1);

	assertSmoothRelease(capture, 0.05, 0.3, 0.2, 0.05);
});
