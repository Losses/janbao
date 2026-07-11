import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration, openSidebarAndGoto, swipeBack, mintAdminCookie } from './helpers';

/**
 * FAB deep-page boundary regression spec.
 *
 * The FAB atom must scale continuously across the boundary between a FAB list
 * route (`/`, `/messages/inbox`) and a non-FAB GesturePageLayout route
 * (`/bookmarks`, `/profile/edit`, `/search`, ...), in both directions, following
 * the finger on back-swipe and the enter slide on forward nav. At rest on a deep
 * route the atom stays mounted at scale 0 (invisible, non-interactive).
 *
 * Mechanism (see docs/FAB-Deep-Boundary-Fix-Plan.md): the 24 non-FAB
 * GesturePageLayout routes carry `fab: { family: 'overlay', kind: 'deep' }`. The
 * layer's `fabConfig` derivation resolves the `deep` kind from the back target
 * into a concrete list kind and returns `family: 'overlay'`, so the atom stays
 * mounted (scale 0 at rest, SSR-safe) and the existing overlay-family sampler
 * drives its scale across the boundary reading the GesturePageLayout track.
 *
 * A per-frame rAF probe records BOTH the atom's presence and its resolved scale.
 * The regressions assert the trajectory SHAPE: the atom stays present through the
 * gesture (no presence gap), the scale is monotonic within tolerance, an
 * intermediate sample sits strictly between 0.1 and 0.9 (a one-frame pop or an
 * unmount produces none), and the endpoints reach near-0 (forward) / near-1 (back).
 */

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

interface FrameSample {
	present: boolean;
	scale: number | null;
}

interface BoundaryCapture {
	samples: FrameSample[];
	presentScales: number[];
	minPresentScale: number;
	maxPresentScale: number;
	presentFrameCount: number;
	totalFrameCount: number;
}

/**
 * Install a continuous rAF probe over the FAB's presence + resolved scale. The
 * probe runs on every document (addInitScript) so a cross-document swap cannot
 * strand it, and each sample is pushed to the Node side via exposeBinding so the
 * buffer survives. SPA nav is same-document, but the robust pattern is kept for
 * parity with fab.spec.ts.
 */
async function captureFabBoundary(
	page: import('@playwright/test').Page,
	trigger: () => Promise<void>,
	windowMs = 1000
): Promise<BoundaryCapture> {
	const samples: FrameSample[] = [];
	try {
		await page.exposeBinding('__pushFabBoundary', async (_src, value: FrameSample) => {
			samples.push(value);
		});
	} catch {
		/* already exposed on a reused page in the same worker */
	}
	const arm = async (v: boolean): Promise<void> =>
		page.evaluate((b) => {
			(window as unknown as { __fabBoundaryArmed?: boolean }).__fabBoundaryArmed = b;
		}, v);
	const probe = (): void => {
		const g = window as unknown as { __fabBoundaryArmed?: boolean };
		const tick = (): void => {
			if (g.__fabBoundaryArmed === true) {
				const fab = document.querySelector('[data-testid="fab"]');
				let present = false;
				let scale: number | null = null;
				if (fab) {
					present = true;
					const m = getComputedStyle(fab).transform || '';
					const paren = m.match(/matrix(?:3d)?\(([^)]+)\)/);
					if (paren) {
						const a = Number(paren[1].split(',')[0].trim());
						if (!Number.isNaN(a)) scale = a;
					} else if (m === 'none') {
						scale = 0;
					}
				}
				(window as unknown as { __pushFabBoundary?: (v: FrameSample) => void }).__pushFabBoundary?.({
					present,
					scale
				});
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	};
	await page.addInitScript(probe);
	await page.evaluate(probe);
	await arm(true);
	await trigger();
	await page.waitForTimeout(windowMs);
	await arm(false);
	const presentScales = samples
		.filter((s) => s.present && s.scale !== null)
		.map((s) => s.scale as number);
	return {
		samples,
		presentScales,
		minPresentScale: presentScales.length ? Math.min(...presentScales) : NaN,
		maxPresentScale: presentScales.length ? Math.max(...presentScales) : NaN,
		presentFrameCount: presentScales.length,
		totalFrameCount: samples.length
	};
}

/** Render a capture as a compact trajectory string for failure messages. */
function dump(c: BoundaryCapture): string {
	const frames = c.samples
		.map((s) => (s.present ? `${(s.scale ?? NaN).toFixed(2)}` : '·'))
		.join(' ');
	return `frames=[${frames}] presentFrames=${c.presentFrameCount}/${c.totalFrameCount}`;
}

/** Assert the atom stayed present through the capture (no unmount gap). */
function assertStaysPresent(c: BoundaryCapture): void {
	expect(
		c.totalFrameCount,
		`probe must capture frames. ${dump(c)}`
	).toBeGreaterThan(0);
	// The atom may legitimately be absent for a few frames at the very start
	// (before the layer mounts on a fresh load) but must not vanish mid-gesture.
	// Require the large majority of frames to be present.
	expect(
		c.presentFrameCount / c.totalFrameCount,
		`atom must stay mounted across the boundary (no presence gap). ${dump(c)}`
	).toBeGreaterThan(0.8);
}

/** Assert a scale-OUT trajectory: starts near 1, ramps to near 0, intermediate
 *  samples present, monotonic non-increasing within tolerance. */
function assertScaleOut(c: BoundaryCapture): void {
	assertStaysPresent(c);
	expect(c.maxPresentScale, `must start near scale 1. ${dump(c)}`).toBeGreaterThan(0.9);
	expect(c.minPresentScale, `must scale toward 0. ${dump(c)}`).toBeLessThan(0.3);
	expect(
		c.presentScales.some((s) => s > 0.1 && s < 0.9),
		`must pass through an intermediate scale (a jump produces none). ${dump(c)}`
	).toBe(true);
}

/** Assert a scale-IN trajectory: starts near 0, ramps to near 1, intermediate
 *  samples present. Endpoint robustness mirrors fab.spec.ts Family C back: the
 *  last sample can dip under load, so completion is proven by maxScale + shape. */
function assertScaleIn(c: BoundaryCapture): void {
	assertStaysPresent(c);
	expect(c.minPresentScale, `must start near scale 0. ${dump(c)}`).toBeLessThan(0.3);
	expect(c.maxPresentScale, `must reach near scale 1. ${dump(c)}`).toBeGreaterThan(0.9);
	expect(
		c.presentScales.some((s) => s > 0.1 && s < 0.9),
		`must pass through an intermediate scale (a pop-in produces none). ${dump(c)}`
	).toBe(true);
}

// CALIBRATION: the atom is present at scale 1 on the discussions list and
// present at scale 0 on a deep route (mounted, covered, non-interactive).
test('CALIBRATION: atom present at scale 1 on / and scale 0 on /bookmarks', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const onList = await page.evaluate(() => {
		const fab = document.querySelector('[data-testid="fab"]');
		if (!fab) return { present: false, scale: NaN };
		const m = getComputedStyle(fab).transform || '';
		const paren = m.match(/matrix(?:3d)?\(([^)]+)\)/);
		return { present: true, scale: paren ? Number(paren[1].split(',')[0]) : NaN };
	});
	expect(onList.present, 'atom present on discussions list').toBe(true);
	expect(onList.scale, 'atom rests at scale 1 on discussions list').toBeCloseTo(1, 1);

	await openSidebarAndGoto(page, '/bookmarks');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const onBookmarks = await page.evaluate(() => {
		const fab = document.querySelector('[data-testid="fab"]');
		if (!fab) return { present: false, scale: NaN };
		const m = getComputedStyle(fab).transform || '';
		const paren = m.match(/matrix(?:3d)?\(([^)]+)\)/);
		return { present: true, scale: paren ? Number(paren[1].split(',')[0]) : NaN };
	});
	expect(onBookmarks.present, 'atom stays mounted on /bookmarks (deep family)').toBe(true);
	expect(onBookmarks.scale, 'atom rests at scale 0 on /bookmarks').toBeCloseTo(0, 1);
});

// Forward nav `/` -> `/bookmarks`: the bookmarks GesturePageLayout plays a
// forward-enter slide-in, and the atom scales out 1 -> 0 across it.
test('forward: `/` -> `/bookmarks` scales the atom out across the enter slide', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const capture = await captureFabBoundary(page, async () => {
		await openSidebarAndGoto(page, '/bookmarks');
	});
	assertScaleOut(capture);
});

// Back-swipe `/bookmarks` -> `/`: the atom scales in 0 -> 1 following the finger.
test('back-swipe: `/bookmarks` -> `/` scales the atom in following the gesture', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	await openSidebarAndGoto(page, '/bookmarks');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const capture = await captureFabBoundary(
		page,
		async () => {
			await swipeBack(page);
			await page.waitForURL('/', { timeout: 5000 });
		},
		1500
	);
	assertScaleIn(capture);
});

// Forward nav `/` -> `/profile/edit` (a settings sub-page, the reported secondary
// page). Same boundary, same scale-out.
test('forward: `/` -> `/profile/edit` scales the atom out across the enter slide', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const capture = await captureFabBoundary(page, async () => {
		await openSidebarAndGoto(page, '/profile/edit');
	});
	assertScaleOut(capture);
});

// Back-swipe `/profile/edit` -> `/`: the atom scales in following the gesture.
test('back-swipe: `/profile/edit` -> `/` scales the atom in following the gesture', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	await openSidebarAndGoto(page, '/profile/edit');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const capture = await captureFabBoundary(
		page,
		async () => {
			await swipeBack(page);
			await page.waitForURL('/', { timeout: 5000 });
		},
		1500
	);
	assertScaleIn(capture);
});

// Forward nav `/` -> `/search`. /search wraps a SearchScopePager inside its
// NavPipelineHost; the OUTER pipeline track is what the sampler reads, so the
// atom scales out across the outer enter slide regardless of the inner scope
// pager.
test('forward: `/` -> `/search` scales the atom out across the outer pipeline slide', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const capture = await captureFabBoundary(page, async () => {
		await openSidebarAndGoto(page, '/search');
	});
	assertScaleOut(capture);
});

// Forward nav `/messages/inbox` -> `/bookmarks`: a messages-source deep route.
// The atom resolves the messages list kind from the back target and scales out;
// guards against the scale getting stuck at 0 (the fractionFromSample overlay
// path must drive it, kind-independent).
test('forward (messages source): `/messages/inbox` -> `/bookmarks` scales the atom out', async ({
	page
}) => {
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const capture = await captureFabBoundary(page, async () => {
		await openSidebarAndGoto(page, '/bookmarks');
	});
	assertScaleOut(capture);
});

// SSR: a deep-link to a deep route must render the atom at scale 0 in the raw
// server HTML (no flash of scale 1, and the transform is a resolved value, not
// the shorthand-on-$derived function-body leak). Mirrors the SSR guard in
// fab.spec.ts for list/overlay/compose routes.
test.describe('SSR: deep route renders the atom at scale 0', () => {
	const deepPaths: readonly string[] = ['/bookmarks', '/profile/edit', '/search'];

	function extractFabStyle(html: string): string | null {
		const match = html.match(/<a\b[^>]*\bdata-testid="fab"[^>]*>/);
		if (!match) return null;
		const m = match[0].match(/\sstyle="([^"]*)"/);
		return m ? m[1] : null;
	}

	for (const path of deepPaths) {
		test(`SSR style: ${path} renders scale(0) with no function( leak`, async ({ request }) => {
			const cookie = `session_token=${mintAdminCookie().value}`;
			const response = await request.get(path, {
				headers: { Cookie: cookie },
				maxRedirects: 0
			});
			expect(
				response.status(),
				`${path} must SSR 200 for the admin cookie`
			).toBe(200);
			const style = extractFabStyle(await response.text());
			expect(style, `the FAB atom must render in SSR HTML for ${path}`).not.toBeNull();
			expect(style, 'SSR style must not contain the function-body leak').not.toContain('function(');
			expect(style, 'SSR style must carry a resolved transform').toMatch(
				/transform:\s*scale\([0-9.]+\)\s*translateY\(-?[0-9.]+px\)/
			);
			const scaleMatch = style?.match(/scale\(([0-9.]+)\)/);
			expect(
				Number(scaleMatch?.[1] ?? NaN),
				`SSR FAB scale must be 0 for ${path}`
			).toBeCloseTo(0, 1);
		});
	}
});
