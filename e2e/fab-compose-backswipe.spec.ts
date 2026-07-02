import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration, swipeBack, openSidebarAndGoto } from './helpers';

/**
 * Compose-route DRAG back-swipe FAB regression.
 *
 * Reported defect: on mobile, tapping the FAB to enter the compose page
 * (/post/discussion) animates the FAB out (forward nav is fine), but a DRAG
 * back-swipe toward the list does NOT scale the FAB in with the finger the way a
 * tab swipe (Family A) or a settings/deep back-swipe (Family B overlay) does.
 * The FAB stays hidden for the whole gesture and only appears AFTER the route
 * commits to the list.
 *
 * Mechanism: /post/discussion mounts the SAME <GesturePageLayout centerTab={0}
 * leftHref="/"> as a deep route, and that GPL publishes the SAME live
 * pager.coverProgress (0..1 with the finger) during the back-swipe. The overlay
 * family reads pager.coverProgress directly, so its FAB follows the finger. The
 * compose family does not: FloatingActionButtonLayer's foregroundFraction
 * derivation hardcodes 0 for family === 'compose' and never reads coverProgress.
 * So during the drag the FAB scale is pinned at scaleFromFraction(0) = 0; only
 * when the route swaps to the list does the family become 'list' and the
 * discreteNavInFlight CSS latch ease the scale 0 -> 1 over 200ms AFTER the swap.
 *
 * Why prior coverage missed it: fab.spec.ts "Family C back" drives the back via
 * page.goBack() (a discrete browser-back), which is eased by the atom's CSS
 * transition and never needs the live gesture signal. The drag is the only path
 * that needs the signal, so the compose branch's missing signal was never
 * exercised. fab-deep-page-boundary.spec.ts covers the drag back-swipe but only
 * for the overlay/deep routes (/bookmarks, /profile/edit, /search) — never the
 * compose family.
 *
 * Discriminator: a per-frame {scale, pathname} probe across the gesture. The
 * gesture is correct iff the FAB scale rises above threshold WHILE the URL is
 * still the source route (finger revealing the list / commit-slide playing,
 * before history lands on the list). The defect produces zero such pre-swap
 * frames: every frame on the compose route is scale ~0, and scale only rises
 * after pathname becomes the list. A matching overlay calibration proves the
 * probe + CDP gesture work for the family that DOES read coverProgress.
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
	/** Pre-swap frames whose scale is strictly inside (0.1, 0.9) — a ramp, not a
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

// CALIBRATION: the deep overlay route /bookmarks reads pager.coverProgress, so a
// drag back-swipe to / scales the FAB in DURING the gesture (before the URL
// swaps). Proves the {scale,path} probe + CDP gesture work; isolates the compose
// defect to the compose branch, not the harness.
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
	expect(
		capture.samples.length,
		`probe must capture frames. ${dump(capture)}`
	).toBeGreaterThan(0);
	expect(capture.maxScale, `overlay FAB must eventually reach scale 1. ${dump(capture)}`).toBeGreaterThan(
		0.9
	);
	expect(
		capture.maxPreSwapScale,
		`overlay FAB must scale in BEFORE the route swaps (follows the finger). ${dump(capture)}`
	).toBeGreaterThan(0.3);
});

// DEFECT (regression guard, expected-fail while the defect is open): the
// compose route /post/discussion ignores pager.coverProgress, so a drag
// back-swipe keeps the FAB at scale 0 until history commits to /. The body
// asserts the CORRECT behaviour, so it throws on the current compose branch;
// `test.fail` marks that throw expected, keeping the suite green while the
// defect is open. Once the compose branch reads coverProgress the body stops
// throwing and Playwright errors "passed but expected to fail" — the cue to
// drop the `.fail` and keep this as a permanent regression guard.
test.fail('DEFECT: `/post/discussion` -> `/` drag back-swipe must scale the FAB in before the swap', async ({
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
	// Sanity: the FAB does eventually appear (the user sees it after the swap).
	expect(
		capture.samples.length,
		`probe must capture frames. ${dump(capture)}`
	).toBeGreaterThan(0);
	expect(
		capture.maxScale,
		`FAB must eventually appear after the swap. ${dump(capture)}`
	).toBeGreaterThan(0.9);
	// The actual contract: the FAB follows the finger, so its scale must rise
	// WHILE the URL is still /post/discussion (gesture + commit-slide window).
	// The defect pins every pre-swap frame at scale 0.
	expect(
		capture.maxPreSwapScale,
		`compose FAB must scale in BEFORE the route swaps to follow the gesture. ${dump(capture)}`
	).toBeGreaterThan(0.3);
});

// DEFECT (messages variant, expected-fail): /messages/new reaches the same
// compose family via MessageCompose.svelte's <GesturePageLayout centerTab={2}
// leftHref="/messages/inbox">, so the identical drag back-swipe defect hits the
// messages source list too. Guards against a fix that lands the coverProgress
// read on the discussions compose route only.
test.fail('DEFECT (messages): `/messages/new` -> `/messages/inbox` drag back-swipe must scale the FAB in before the swap', async ({
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
	expect(
		capture.samples.length,
		`probe must capture frames. ${dump(capture)}`
	).toBeGreaterThan(0);
	expect(
		capture.maxScale,
		`FAB must eventually appear after the swap. ${dump(capture)}`
	).toBeGreaterThan(0.9);
	expect(
		capture.maxPreSwapScale,
		`messages compose FAB must scale in BEFORE the route swaps to follow the gesture. ${dump(capture)}`
	).toBeGreaterThan(0.3);
});
