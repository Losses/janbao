import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration, swipeForward } from './helpers';

// NavPipelineTabHost regression coverage for a tab-to-tab swipe. Drives a
// forward swipe `/` -> `/activity` and asserts three in-flight properties
// the orchestrator must hold end to end:
//
//   1. The track slides (>= 3 intermediate frames with a delta > 50px from
//      the resting m41). A snap or a no-op driver fails this.
//   2. The FAB animates (scale delta > 0.1). The orchestrator publishes
//      trackFractionalIndex across the slide and `tabFraction(track position,
//      tabIndex)` drives the FAB scale.
//   3. The Header stays in hamburger mode (the icon's mask group never
//      rotates toward the back-arrow). This is the regression test for the
//      orchestrator's tab-host pager publication: when `centerTab ===
//      undefined && bidirectional === true`, `#republishToPager` must
//      publish `backMorph: null` so the Header's `pager.backMorph ?? 1`
//      fallback keeps `morph === 1` (hamburger) throughout the swipe.
//      Publishing `backMorph: rawDragFraction` (the deep-page branch) would
//      morph the icon toward the back-arrow mid-swipe.
//
// detectSwipe rejects pointerType 'mouse', so the gesture is driven via the
// shared CDP `swipeForward` helper. The rAF sampler is installed via
// `addInitScript` + `exposeBinding` so it survives the cross-document
// navigation when the swipe commits.

interface TabHostFrame {
	trackM41: number;
	fabScale: number | null;
	headerRotationDeg: number | null;
}

interface TabHostSamplerGlobals {
	__tabHostArmed?: boolean;
	__pushTabHostSample?: (frame: TabHostFrame) => void;
}

interface TabHostSamplerWindow extends Window {
	__tabHostArmed?: boolean;
}

const SAMPLER_WINDOW_MS = 1800;

test.describe('NavPipelineTabHost tab-swipe regression', () => {
	test.beforeEach(async ({ context }) => {
		await prepareContext(context);
	});

	test('forward swipe / -> /activity slides the track, scales the FAB, and keeps the Header in hamburger mode', async ({
		page
	}) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.waitForTimeout(300);

		const frames: TabHostFrame[] = [];
		try {
			await page.exposeBinding('__pushTabHostSample', async (_src, frame: TabHostFrame) => {
				frames.push(frame);
			});
		} catch {
			// Already exposed on this page (a prior spec in the same worker).
		}

		const samplerScript = (): void => {
			const g = window as unknown as TabHostSamplerGlobals;
			const tick = (): void => {
				if (g.__tabHostArmed === true) {
					// Track m41 from the NavPipelineTabHost track.
					let trackM41 = 0;
					const track = document.querySelector('[data-testid="nav-pipeline-tab-track"]') as
						| HTMLElement
						| null;
					if (track) {
						try {
							trackM41 = new DOMMatrix(getComputedStyle(track).transform).m41;
						} catch {
							trackM41 = 0;
						}
					}
					// FAB resolved scale.
					let fabScale: number | null = null;
					const fab = document.querySelector('[data-testid="fab"]') as HTMLElement | null;
					if (fab) {
						const matrix = getComputedStyle(fab).transform || '';
						const paren = matrix.match(/matrix(?:3d)?\(([^)]+)\)/);
						if (paren) {
							const a = Number(paren[1].split(',')[0].trim());
							if (!Number.isNaN(a)) fabScale = a;
						} else if (matrix === 'none') {
							fabScale = 0;
						}
					}
					// Header icon mask rotation. At morph=1 (hamburger) the
					// mask group rests at rotate(0deg); a morph toward 0
					// (back-arrow) rotates it. Any frame whose rotation is
					// significantly past 0 means the orchestrator published a
					// numeric backMorph and the Header fell into deep-page
					// mode.
					let headerRotationDeg: number | null = null;
					const header = document.querySelector('header');
					const maskG = header?.querySelector('svg mask g') as HTMLElement | null;
					if (maskG) {
						const t = maskG.style.transform || '';
						const m = t.match(/rotate\(([-0-9.]+)deg\)/);
						if (m) headerRotationDeg = Number(m[1]);
					}
					g.__pushTabHostSample?.({ trackM41, fabScale, headerRotationDeg });
				}
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		};
		await page.addInitScript(samplerScript);
		await page.evaluate(samplerScript);

		await armSampler(page, true);
		await swipeForward(page);
		try {
			await page.waitForURL('**/activity', { timeout: 5000 });
		} catch {
			/* The swipe may race the assertion; the sampler window still holds. */
		}
		await page.waitForTimeout(SAMPLER_WINDOW_MS);
		await armSampler(page, false);

		// (1) Track slides: at least 3 intermediate frames whose m41 differs
		// from the resting m41 by > 50px. The resting m41 is the first
		// captured frame's value (the track at -0*W = 0 at tab 0).
		expect(frames.length, 'sampler must have captured frames across the swipe').toBeGreaterThanOrEqual(
			6
		);
		const restM41 = frames[0].trackM41;
		const slidingFrames = frames.filter((f) => Math.abs(f.trackM41 - restM41) > 50);
		expect(
			slidingFrames.length,
			'track must slide through at least 3 intermediate frames > 50px from rest'
		).toBeGreaterThanOrEqual(3);

		// (2) FAB animates: the scale delta across the window must exceed 0.1.
		// The discussions FAB rests at scale 1 on `/` and the activity tab has
		// no FAB, so the Family A sampler drives the scale toward 0 across the
		// slide.
		const fabScales = frames
			.map((f) => f.fabScale)
			.filter((s): s is number => s !== null && Number.isFinite(s));
		const fabDelta =
			fabScales.length > 0 ? Math.max(...fabScales) - Math.min(...fabScales) : 0;
		expect(
			fabDelta,
			'FAB scale must animate (delta > 0.1) across the tab swipe'
		).toBeGreaterThan(0.1);

		// (3) Header stays in hamburger mode: every sampled rotation must
		// stay within 5deg of 0 (the morph=1 hamburger rest). A rotation
		// toward 180deg means the Header fell into deep-page mode (numeric
		// backMorph published), which is the Fix 1 regression.
		const headerRotations = frames
			.map((f) => f.headerRotationDeg)
			.filter((r): r is number => r !== null && Number.isFinite(r));
		expect(
			headerRotations.length,
			'sampler must have read the Header icon rotation across the swipe'
		).toBeGreaterThan(0);
		const maxAbsRotation = Math.max(...headerRotations.map((r) => Math.abs(r)));
		expect(
			maxAbsRotation,
			'Header icon must stay at rotate(0deg) (hamburger mode) throughout the tab swipe; a rotation toward 180deg means a numeric backMorph leaked'
		).toBeLessThan(5);
	});
});

async function armSampler(page: import('@playwright/test').Page, armed: boolean): Promise<void> {
	await page.evaluate((v) => {
		(window as unknown as TabHostSamplerWindow).__tabHostArmed = v;
	}, armed);
}
