import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration, swipeBack, openSidebarAndGoto } from './helpers';

/**
 * Compose-family FAB regression guards (DV16).
 *
 * These specs guard two invariants of the FAB scale signal:
 *
 *  1. The compose family reads the orchestrator's `publication.progress`
 *     (like the overlay family) via `fabScale(progress, fromHasFab, toHasFab)`,
 *     so the FAB follows the finger during a drag back-swipe from a compose route
 *     toward its source list, scaling in over the last 50% of the gesture.
 *  2. A cross-tab tap from a compose route is intercepted by the pipeline
 *     orchestrator, which publishes `publication.progress` across the slide so the FAB
 *     stays hidden for a destination without a resting FAB.
 *
 * Discriminator: a per-frame `{scale, pathname}` probe across the gesture. The
 * back-swipe contract holds iff the FAB scale rises above threshold AND passes
 * through an intermediate value WHILE the URL is still the compose route
 * (pre-swap). The cross-tab transition contract holds iff the FAB scale stays
 * below threshold across the orchestrator-driven slide (no resting FAB on the
 * destination tab). Both sample the resolved `getComputedStyle(fab).transform`
 * (tautology-resistant) and key the window to live DOM state (the pathname),
 * not to internal flags. A CALIBRATION spec on the deep route `/bookmarks`
 * proves the probe and the CDP gesture surface work for a family that already
 * reads `publication.progress`.
 */

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

interface FrameSample {
	scale: number | null;
	path: string;
}

interface BackSwipeCapture {
	samples: FrameSample[];
	/** Frames recorded while the URL was still the source route (gesture +
	 * commit-slide window, before history landed on the list). */
	preSwap: FrameSample[];
	/** Frames recorded after the URL became the list. */
	postSwap: FrameSample[];
	/** Max resolved scale among pre-swap present frames (NaN if none). The
	 * gesture-follows-finger contract requires this to rise well above 0. */
	maxPreSwapScale: number;
	/** Pre-swap frames whose scale is strictly inside (0.1, 0.9) - a ramp, not a
	 * held-0 or a single pop. */
	preSwapIntermediateCount: number;
	/** Overall max resolved scale (proves the FAB eventually appears at all). */
	maxScale: number;
}

/**
 * Install a continuous rAF probe over the FAB's resolved scale + the current
 * pathname, armed across `trigger`. addInitScript re-arms on every new document
 * and exposeBinding holds the buffer on the Node side, so a cross-document swap
 * cannot strand it (mirrors the fab.spec.ts / fab-deep-page-boundary samplers).
 */
async function captureBackSwipe(
	page: import('@playwright/test').Page,
	sourcePath: string,
	trigger: () => Promise<void>,
	windowMs = 1800
): Promise<BackSwipeCapture> {
	const samples: FrameSample[] = [];
	try {
		await page.exposeBinding('__pushComposeFrame', async (_src, value: FrameSample) => {
			samples.push(value);
		});
	} catch {
		/* already exposed on a reused page in the same worker */
	}
	const arm = async (v: boolean): Promise<void> =>
		page.evaluate((b) => {
			(window as unknown as { __composeArmed?: boolean }).__composeArmed = b;
		}, v);
	const probe = (): void => {
		const g = window as unknown as { __composeArmed?: boolean };
		const tick = (): void => {
			if (g.__composeArmed === true) {
				const fab = document.querySelector('[data-testid="fab"]');
				let scale: number | null = null;
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
				(window as unknown as { __pushComposeFrame?: (v: FrameSample) => void }).__pushComposeFrame?.({
					scale,
					path: location.pathname
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

	const present = samples.filter((s) => s.scale !== null) as { scale: number; path: string }[];
	const preSwap = present.filter((s) => s.path === sourcePath);
	const postSwap = present.filter((s) => s.path !== sourcePath);
	const nums = (arr: { scale: number }[]): number[] => arr.map((s) => s.scale);
	const preSwapScales = nums(preSwap);
	const allScales = nums(present);
	return {
		samples,
		preSwap: preSwap as FrameSample[],
		postSwap: postSwap as FrameSample[],
		maxPreSwapScale: preSwapScales.length ? Math.max(...preSwapScales) : NaN,
		preSwapIntermediateCount: preSwapScales.filter((s) => s > 0.1 && s < 0.9).length,
		maxScale: allScales.length ? Math.max(...allScales) : NaN
	};
}

/** Render a capture as a compact trajectory for failure messages. */
function dump(c: BackSwipeCapture): string {
	const fmt = (s: FrameSample): string => {
		const tag = s.path === '/' ? '/' : s.path;
		return `${s.scale === null ? '·' : s.scale.toFixed(2)}@${tag}`;
	};
	const pre = c.preSwap
		.slice(-40)
		.map(fmt)
		.join(' ');
	const post = c.postSwap
		.slice(0, 16)
		.map(fmt)
		.join(' ');
	return `maxPreSwap=${Number.isNaN(c.maxPreSwapScale) ? 'NaN' : c.maxPreSwapScale.toFixed(2)} preInt=${c.preSwapIntermediateCount} max=${Number.isNaN(c.maxScale) ? 'NaN' : c.maxScale.toFixed(2)}\n   pre(swap)=${pre}\n   post(swap)=${post}`;
}

// CALIBRATION: the deep overlay route /bookmarks reads the orchestrator's
// publication.progress, so a drag back-swipe to / scales the FAB in DURING the
// gesture (before the URL swaps). Proves the {scale,path} probe + CDP gesture
// work; isolates a compose regression to the compose branch, not the harness.
test('CALIBRATION (overlay): `/bookmarks` -> `/` drag back-swipe scales the FAB in before the swap', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	await openSidebarAndGoto(page, '/bookmarks');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const capture = await captureBackSwipe(page, '/bookmarks', async () => {
		await swipeBack(page);
		await page.waitForURL('/', { timeout: 5000 });
	});
	expect(capture.samples.length, `probe must capture frames. ${dump(capture)}`).toBeGreaterThan(0);
	expect(capture.maxScale, `overlay FAB must eventually reach scale 1. ${dump(capture)}`).toBeGreaterThan(
		0.9
	);
	expect(
		capture.maxPreSwapScale,
		`overlay FAB must scale in BEFORE the route swaps (follows the finger). ${dump(capture)}`
	).toBeGreaterThan(0.3);
	expect(
		capture.preSwapIntermediateCount,
		`overlay FAB must ramp (an intermediate sample in 0.1..0.9), not pop. ${dump(capture)}`
	).toBeGreaterThan(0);
});

// Compose (discussions): the compose family reads the orchestrator's
// publication.progress, so a drag back-swipe /post/discussion -> / scales the
// FAB in BEFORE the route swaps.
test('compose `/post/discussion` -> `/` drag back-swipe scales the FAB in before the swap', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	await page.locator('[data-testid="fab"]').click({ force: true });
	await page.waitForURL('/post/discussion', { timeout: 5000 });
	await page.waitForTimeout(300);
	const capture = await captureBackSwipe(page, '/post/discussion', async () => {
		await swipeBack(page);
		await page.waitForURL('/', { timeout: 5000 });
	});
	expect(capture.samples.length, `probe must capture frames. ${dump(capture)}`).toBeGreaterThan(0);
	expect(capture.maxScale, `FAB must eventually reach scale 1. ${dump(capture)}`).toBeGreaterThan(0.9);
	expect(
		capture.maxPreSwapScale,
		`compose FAB must scale in BEFORE the route swaps to follow the gesture. ${dump(capture)}`
	).toBeGreaterThan(0.3);
	expect(
		capture.preSwapIntermediateCount,
		`compose FAB must ramp (an intermediate sample in 0.1..0.9), not pop. ${dump(capture)}`
	).toBeGreaterThan(0);
});

// Compose (messages): /messages/new reaches the same compose family via
// MessageCompose.svelte's <NavPipelineHost centerTab={2} leftHref="/messages/inbox">.
// Guards against a fix that lands the publication.progress read on the discussions
// compose route only.
test('compose (messages) `/messages/new` -> `/messages/inbox` drag back-swipe scales the FAB in before the swap', async ({
	page
}) => {
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	await page.locator('[data-testid="fab"]').click({ force: true });
	await page.waitForURL('/messages/new', { timeout: 5000 });
	await page.waitForTimeout(300);
	const capture = await captureBackSwipe(page, '/messages/new', async () => {
		await swipeBack(page);
		await page.waitForURL('/messages/inbox', { timeout: 5000 });
	});
	expect(capture.samples.length, `probe must capture frames. ${dump(capture)}`).toBeGreaterThan(0);
	expect(capture.maxScale, `FAB must eventually reach scale 1. ${dump(capture)}`).toBeGreaterThan(0.9);
	expect(
		capture.maxPreSwapScale,
		`messages compose FAB must scale in BEFORE the route swaps to follow the gesture. ${dump(capture)}`
	).toBeGreaterThan(0.3);
	expect(
		capture.preSwapIntermediateCount,
		`messages compose FAB must ramp (an intermediate sample in 0.1..0.9), not pop. ${dump(capture)}`
	).toBeGreaterThan(0);
});

interface ChipFrame {
	scale: number | null;
	hasOverlay: boolean;
}

/**
 * Cross-tab transition guard: a drawer/tab tap from /post/discussion toward a
 * different tab is intercepted by the orchestrator (NavPipelineHost), which
 * publishes transitionTarget. The FAB layer forces scale 0 when the target
 * shows no resting FAB. The FAB must stay hidden (scale ~0) for every frame
 * of the orchestrator-driven slide, not paint above it at scale 1.
 */
test('compose `/post/discussion` cross-tab transition keeps the FAB hidden', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	await page.locator('[data-testid="fab"]').click({ force: true });
	await page.waitForURL('/post/discussion', { timeout: 5000 });
	await waitForHydration(page);
	await page.waitForTimeout(300);

	const samples: ChipFrame[] = [];
	try {
		await page.exposeBinding('__pushChipFrame', async (_src, value: ChipFrame) => {
			samples.push(value);
		});
	} catch {
		/* already exposed on a reused page in the same worker */
	}
	const probe = (): void => {
		const g = window as unknown as { __chipArmed?: boolean };
		const tick = (): void => {
			if (g.__chipArmed === true) {
				const fab = document.querySelector('[data-testid="fab"]');
				let scale: number | null = null;
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
				(window as unknown as { __pushChipFrame?: (v: ChipFrame) => void }).__pushChipFrame?.({
					scale,
					hasOverlay: !!document.querySelector('.loading-overlay')
				});
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	};
	await page.addInitScript(probe);
	await page.evaluate(probe);
	await page.evaluate((b) => {
		(window as unknown as { __chipArmed?: boolean }).__chipArmed = b;
	}, true);
	// Cross-tab tap to a different tab triggers the orchestrator's slide plan.
	await openSidebarAndGoto(page, '/activity');
	await page.waitForURL('/activity', { timeout: 5000 });
	await page.waitForTimeout(500);
	await page.evaluate((b) => {
		(window as unknown as { __chipArmed?: boolean }).__chipArmed = b;
	}, false);

	const presentFrames = samples.filter((s) => s.scale !== null) as {
		scale: number;
		hasOverlay: boolean;
	}[];
	const scales = presentFrames.map((s) => s.scale);
	const maxScale = scales.length ? Math.max(...scales) : NaN;
	expect(presentFrames.length, 'the cross-tab transition must capture FAB frames').toBeGreaterThan(0);
	expect(
		maxScale,
		`compose FAB must stay hidden (scale < 0.1) during the cross-tab transition from /post/discussion. maxScale=${Number.isNaN(maxScale) ? 'NaN' : maxScale.toFixed(2)}`
	).toBeLessThan(0.1);
});

// Overlay (deep branch) variant of the cross-tab FAB guard. /bookmarks runs on
// NavPipelineHost (no LoadingChip); a cross-tab tap is intercepted by the
// orchestrator which publishes transitionTarget, and the FAB layer forces scale
// 0 when the target shows no resting FAB. Covers the deep-page transition
// gating that the compose (centerTab) test above does not reach.
test('overlay `/bookmarks` cross-tab transition keeps the FAB hidden', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	await openSidebarAndGoto(page, '/bookmarks');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	const samples: ChipFrame[] = [];
	try {
		await page.exposeBinding('__pushChipFrame', async (_src, value: ChipFrame) => {
			samples.push(value);
		});
	} catch {
		/* already exposed on a reused page in the same worker */
	}
	const probe = (): void => {
		const g = window as unknown as { __chipArmed?: boolean };
		const tick = (): void => {
			if (g.__chipArmed === true) {
				const fab = document.querySelector('[data-testid="fab"]');
				let scale: number | null = null;
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
				(window as unknown as { __pushChipFrame?: (v: ChipFrame) => void }).__pushChipFrame?.({
					scale,
					hasOverlay: !!document.querySelector('.loading-overlay')
				});
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	};
	await page.addInitScript(probe);
	await page.evaluate(probe);
	await page.evaluate((b) => {
		(window as unknown as { __chipArmed?: boolean }).__chipArmed = b;
	}, true);
	// Cross-tab tap to a different tab triggers the orchestrator's slide plan.
	await openSidebarAndGoto(page, '/activity');
	await page.waitForURL('/activity', { timeout: 5000 });
	await page.waitForTimeout(500);
	await page.evaluate((b) => {
		(window as unknown as { __chipArmed?: boolean }).__chipArmed = b;
	}, false);

	const presentFrames = samples.filter((s) => s.scale !== null) as {
		scale: number;
		hasOverlay: boolean;
	}[];
	const scales = presentFrames.map((s) => s.scale);
	const maxScale = scales.length ? Math.max(...scales) : NaN;
	expect(presentFrames.length, 'the cross-tab transition must capture FAB frames').toBeGreaterThan(0);
	expect(
		maxScale,
		`overlay FAB must stay hidden (scale < 0.1) during the cross-tab transition from /bookmarks. maxScale=${Number.isNaN(maxScale) ? 'NaN' : maxScale.toFixed(2)}`
	).toBeLessThan(0.1);
});
