import { test, expect, type Page } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

/**
 * Hamburger flashes to an arrow for a few frames on /search -> / BROWSER back.
 *
 * Reproduction (user report): mobile, land on /, tap the search button (SPA nav
 * to /search), then press the browser's BACK button to return to /. Most of the
 * time the header is fine, but intermittently the hamburger icon plays its
 * arrow morph for a few milliseconds and immediately snaps back to a hamburger.
 *
 * Suspected data flow (verified empirically by the sampler below, not asserted
 * a priori):
 *
 *   click search  : /  --(pushState)-->  /search
 *     Header.mode flips root -> search; isSearch = true.
 *     Effect E (root<->search scrub trigger) sees currentHasTabs flip
 *     (true -> false) AND isSearch flip (false -> true) and calls
 *     startSearchScrub(prevTabs ? 1 : 0, curTabs ? 1 : 0) = startSearchScrub(1, 0).
 *     `morph` scrubs 1 -> 0 over ~200ms, but isSearch is already true so
 *     iconProgress = isSearch ? 0 : 1 - morph = 0 the whole way. No flash.
 *
 *   browser back  : /search --(popstate)-->  /
 *     Header.mode flips search -> root; isSearch = false.
 *     Effect E sees currentHasTabs flip (false -> true) AND isSearch flip
 *     (true -> false) and calls startSearchScrub(0, 1). `morph` scrubs 0 -> 1.
 *     At scrub progress 0 morph = 0, so iconProgress = 1 - 0 = 1 = ARROW.
 *     iconProgress then decays 1 -> 0 as morph scrubs 0 -> 1 (~200ms).
 *     So for the first ~100ms+ of the back transition the icon's TARGET is the
 *     back arrow; the CSS `transform 200ms ease-out` transition on the SVG
 *     group turns that into a brief visible rotate-then-return: the flash.
 *
 * The bug is ASYMMETRIC: only the search -> root direction exposes iconProgress
 * to the scrub, because the forward direction forces iconProgress to 0 via the
 * `isSearch ? 0` short-circuit before the scrub can drive it. The ENTER test
 * below guards that asymmetry (forward must NOT flash); the DEFECT test below
 * reproduces the back-direction flash.
 *
 * Detection: the BurgerArrowIcon renders one `<svg><defs><mask id="burger-
 * arrow"><g style="...rotate(Xdeg)...">`. That group's inline `rotate(Xdeg)` IS
 * `180 * iconProgress` (p in the atom), so it is a direct read-out of the value
 * under test. We sample it every animation frame across the back navigation and
 * assert it never leaves the hamburger band (X ~= 0) while we are on /.
 */

interface IconFrame {
	t: number;
	path: string;
	/** Inline `rotate(Xdeg)` of the mask group = 180 * iconProgress (the TARGET).
	 * 0 = hamburger, 180 = back arrow. Null when the icon is not in the DOM. */
	targetRot: number | null;
	/** Computed (painted) rotation parsed from getComputedStyle's matrix - the
	 * actual on-screen rotation mid-transition. Null when unreadable. */
	paintedRot: number | null;
	/** Header search track translateX (px). ~0 at a tab root, ~-half-viewport in
	 * search. Corroborates that the scrub drove `morph`. */
	trackTx: number | null;
}

interface IconLog {
	frames: IconFrame[];
	done: boolean;
}

interface IconWindow extends Window {
	__iconLog?: IconLog;
}

interface SamplerOpts {
	windowMs: number;
	groupSel: string;
	trackSel: string;
}

const GROUP_SELECTOR = 'header svg mask g';
const TRACK_SELECTOR = 'header div.flex.w-\\[200\\%\\]';
const SAMPLE_WINDOW_MS = 1800;

async function installIconSampler(page: Page): Promise<void> {
	await page.evaluate(
		({ windowMs, groupSel, trackSel }) => {
			const w = window as unknown as IconWindow;
			const log: IconLog = { frames: [], done: false };
			w.__iconLog = log;
			const rotOf = (el: Element): number | null => {
				const tf = getComputedStyle(el).transform;
				if (!tf || tf === 'none') return 0;
				try {
					const m = new DOMMatrix(tf);
					const deg = (Math.atan2(m.b, m.a) * 180) / Math.PI;
					// Normalise to [0, 180]; the morph only ever rotates 0 -> 180.
					return Math.abs(deg) > 90 ? 180 - Math.abs(deg % 180) : Math.abs(deg);
				} catch {
					return null;
				}
			};
			const txOf = (el: Element | null): number | null => {
				if (!el) return null;
				try {
					return new DOMMatrix(getComputedStyle(el).transform).m41;
				} catch {
					return null;
				}
			};
			const start = performance.now();
			const tick = (): void => {
				const g = document.querySelector(groupSel) as HTMLElement | null;
				let targetRot: number | null = null;
				if (g) {
					const inline = g.style.transform ?? '';
					const m = inline.match(/rotate\(([-\d.]+)deg\)/);
					targetRot = m ? Math.abs(Number(m[1])) : null;
				}
				log.frames.push({
					t: Math.round(performance.now() - start),
					path: location.pathname,
					targetRot,
					paintedRot: g ? rotOf(g) : null,
					trackTx: txOf(document.querySelector(trackSel))
				});
				if (performance.now() - start > windowMs) {
					log.done = true;
					return;
				}
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		},
		{
			windowMs: SAMPLE_WINDOW_MS,
			groupSel: GROUP_SELECTOR,
			trackSel: TRACK_SELECTOR
		} satisfies SamplerOpts
	);
}

async function readIconLog(page: Page): Promise<IconFrame[]> {
	return page.evaluate(() => {
		const log = (window as unknown as IconWindow).__iconLog;
		return log ? log.frames : [];
	});
}

/** Max icon target rotation (deg) observed on the root `/` after leaving /search. */
interface FlashSummary {
	maxTargetOnRoot: number;
	maxPaintedOnRoot: number;
	maxTargetOverall: number;
	rootFrameCount: number;
	/** First root frame whose target rotation left the hamburger band, if any. */
	firstFlashT: number | null;
	/** ms the target rotation stayed above 30deg on root (the visible flash span). */
	flashSpanMs: number;
}

function summarizeFlash(log: IconFrame[]): FlashSummary {
	let maxTargetOnRoot = 0;
	let maxPaintedOnRoot = 0;
	let maxTargetOverall = 0;
	let rootFrameCount = 0;
	let firstFlashT: number | null = null;
	let lastFlashT: number | null = null;
	for (const f of log) {
		const t = f.targetRot ?? 0;
		if (t > maxTargetOverall) maxTargetOverall = t;
		if (f.path !== '/') continue;
		rootFrameCount++;
		if (t > maxTargetOnRoot) maxTargetOnRoot = t;
		const p = f.paintedRot ?? 0;
		if (p > maxPaintedOnRoot) maxPaintedOnRoot = p;
		if (t > 30) {
			if (firstFlashT === null) firstFlashT = f.t;
			lastFlashT = f.t;
		}
	}
	return {
		maxTargetOnRoot,
		maxPaintedOnRoot,
		maxTargetOverall,
		rootFrameCount,
		firstFlashT,
		flashSpanMs: firstFlashT !== null && lastFlashT !== null ? lastFlashT - firstFlashT : 0
	};
}

/** Hard-load / and wait for the SPA to be ready. */
async function loadRoot(page: Page): Promise<void> {
	await page.goto('/');
	await waitForHydration(page);
}

/** SPA-navigate from / to /search (no hard reload). Assumes the page is on /. */
async function enterSearch(page: Page): Promise<void> {
	await page.locator('header a[href="/search"][aria-label]').click();
	await page.waitForURL('**/search', { timeout: 8000 });
	// Let the entry scrub + CSS transitions fully settle so the back nav starts
	// from the steady search state (the realistic precondition for the flash).
	await page.waitForTimeout(450);
}

/**
 * Why a warm-up: the flash is gated by Effect E's `if (settling) return` guard.
 * A lingering deep-title settle (armed by the initial hard load) holds
 * `settling === true` at the FIRST back moment, which makes Effect E skip
 * `startSearchScrub` so `morph` never scrubs 0 -> 1 and the icon stays at
 * `iconProgress = 0` (hamburger) the whole way: NO flash, by accident. Once the
 * title state machine is idle (`settling === false`) the guard passes and every
 * /search -> / back scrubs `morph` 0 -> 1, driving `iconProgress` 1 -> 0: the
 * flash. This is the exact mechanism behind the user's "intermittent" report.
 * The warm-up runs one throwaway / -> /search -> back over SPA nav (no hard
 * reload, which would re-arm the masking settle) so the title state machine is
 * idle for the instrumented back that follows, making the defect reproducible
 * every run instead of only on the post-settle iterations.
 */
async function warmUpOnce(page: Page): Promise<void> {
	await enterSearch(page);
	await page.goBack();
	await page.waitForURL('**/', { timeout: 8000 });
	await page.waitForTimeout(500);
}

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

// CALIBRATION: prove the harness reaches /search, the browser back returns to /,
// and the sampler caught frames on both pages. If this fails the defect
// assertion below is meaningless (the back nav never landed, or the icon was
// never sampled on /).
test('CALIBRATION: / -> /search -> browser-back -> / reaches / with the icon sampler live', async ({
	page
}) => {
	await loadRoot(page);
	await enterSearch(page);

	await installIconSampler(page);
	await page.goBack();
	await page.waitForURL('**/', { timeout: 8000 });
	await page.waitForTimeout(500);

	const log = await readIconLog(page);
	expect(log.length, 'sampler must capture frames across the back nav').toBeGreaterThan(20);
	expect(
		log.some((f) => f.path === '/search'),
		'precondition: frames captured on /search before the back'
	).toBe(true);
	const rootFrames = log.filter((f) => f.path === '/');
	expect(rootFrames.length, 'precondition: frames captured on / after the back').toBeGreaterThan(
		10
	);
	expect(new URL(page.url()).pathname).toBe('/');
});

// DEFECT: on the browser back /search -> / the hamburger must STAY a hamburger.
// It must not flash toward the back arrow. The icon target rotation (180 *
// iconProgress) must remain in the hamburger band (<= 15deg) for every frame on
// /. In the current build the search-scrub drives `morph` 0 -> 1 over ~200ms,
// and `iconProgress = isSearch ? 0 : 1 - morph` follows it 1 -> 0, so the first
// scrub frame paints `iconProgress = 1` (full arrow) and decays: the target
// rotation peaks near 180deg. The warm-up idles the title state machine first so
// the flash reproduces every run.
test('DEFECT: browser-back /search -> / must not flash the hamburger into an arrow', async ({
	page
}) => {
	await loadRoot(page);
	await warmUpOnce(page);
	await enterSearch(page);

	await installIconSampler(page);
	await page.goBack();
	await page.waitForURL('**/', { timeout: 8000 });
	// Capture through the ~200ms scrub + the CSS transition settle.
	await page.waitForTimeout(700);

	const log = await readIconLog(page);
	const s = summarizeFlash(log);

	console.log(
		'BACK /search -> / flash summary:',
		`maxTargetOnRoot=${s.maxTargetOnRoot.toFixed(1)}deg`,
		`maxPaintedOnRoot=${s.maxPaintedOnRoot.toFixed(1)}deg`,
		`flashSpan=${s.flashSpanMs}ms`,
		`rootFrames=${s.rootFrameCount}`,
		s.firstFlashT !== null ? `firstFlash@${s.firstFlashT}ms` : 'noFlash'
	);

	expect(
		s.rootFrameCount,
		'precondition: the sampler captured the icon on / after the back'
	).toBeGreaterThan(10);
	expect(
		s.maxTargetOnRoot,
		`hamburger flashed to an arrow on /search -> / back. ` +
			`maxTargetOnRoot=${s.maxTargetOnRoot.toFixed(1)}deg (180 = full arrow), ` +
			`maxPaintedOnRoot=${s.maxPaintedOnRoot.toFixed(1)}deg, ` +
			`flashSpan=${s.flashSpanMs}ms. ` +
			`The icon target rotation must stay in the hamburger band (<=15deg) the whole time.`
	).toBeLessThanOrEqual(15);
});

// INTERMITTENCY: the user reports the flash as intermittent. It is NOT random:
// the first back after a fresh page load is masked by a lingering title settle
// (see `warmUpOnce`), and every subsequent back flashes. Repeat the cycle from a
// fresh load and the per-iteration array shows exactly that signature: iteration
// 0 clean, iterations 1+ flash. A fix must bring every iteration into the
// hamburger band.
test('INTERMITTENCY: first back after load is masked, subsequent backs flash (reproduces the user report)', async ({
	page
}) => {
	await loadRoot(page);

	const perIterMax: number[] = [];
	const ITERS = 5;
	for (let i = 0; i < ITERS; i++) {
		await enterSearch(page);

		await installIconSampler(page);
		await page.goBack();
		await page.waitForURL('**/', { timeout: 8000 });
		await page.waitForTimeout(500);
		const log = await readIconLog(page);
		const s = summarizeFlash(log);
		perIterMax.push(s.maxTargetOnRoot);
	}

	console.log('per-iteration maxTargetOnRoot (deg):', perIterMax.map((v) => v.toFixed(1)));

	expect(
		perIterMax.every((v) => v <= 15),
		`flash reproduced on ${perIterMax.filter((v) => v > 15).length}/${ITERS} iterations. ` +
			`per-iter maxTargetOnRoot=${perIterMax.map((v) => v.toFixed(1)).join(', ')}deg`
	).toBe(true);
});

// ASYMMETRY: the forward direction / -> /search must NOT flash. `isSearch`
// flips true in the same flush as the scrub starts, so the `isSearch ? 0` short-
// circuit forces `iconProgress = 0` before the scrub can drive it. This documents
// that the defect is specific to the search -> root direction and guards the
// forward side against a regression that symmetrises it.
test('ASYMMETRY: forward tap / -> /search does NOT flash the hamburger (reference, correct)', async ({
	page
}) => {
	await loadRoot(page);

	await installIconSampler(page);
	await enterSearch(page);

	const log = await readIconLog(page);
	// The icon must stay a hamburger on / (pre-nav) AND on /search (post-nav).
	const maxTarget = log.reduce((m, f) => Math.max(m, f.targetRot ?? 0), 0);

	console.log(`FORWARD / -> /search maxTargetOverall=${maxTarget.toFixed(1)}deg`);

	expect(
		maxTarget,
		`forward / -> /search must keep the icon a hamburger (<=15deg), got ${maxTarget.toFixed(1)}deg`
	).toBeLessThanOrEqual(15);
});
