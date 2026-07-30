import { test, expect, type Page } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

/**
 * Regression guard: the hamburger icon stays a hamburger across a /search <->
 * tab-root transition. The Header `iconProgress` feeds `BurgerArrowIcon` and is
 * frozen during a search transition:
 *
 *   const iconProgress = $derived.by(() => {
 *     if (searchScrubbing && pager.tapMorph !== null) {
 *       return pager.tapMorph * (pager.scrubIconEndpoint ?? 0);
 *     }
 *     return isSearch || (searchScrubbing && currentHasTabs) ? 0 : 1 - morph;
 *   });
 *
 * `morph` drives the root<->deep VERTICAL morph (the icon's actual domain,
 * where `1 - morph` turns the hamburger into a back arrow on a deep page).
 * The root<->search HORIZONTAL scrub lives in `searchProgress` /
 * `trackMorph` / `tabProgress` (the search track / scope-tab bar / search
 * button), and the morph derivation's `targetIsSearch` skip excludes that
 * scrub from `morph` during a forward-swipe-to-/search drag. The icon must
 * be inert during the horizontal scrub, so `iconProgress` freezes to 0
 * (hamburger) whenever `isSearch` (search-mode rest) OR
 * (`searchScrubbing` && `currentHasTabs`) (the tap scrub in flight on a
 * tab-root page) holds. Both endpoints of a root<->search transition rest
 * the icon at the hamburger, so freezing at 0 is correct for both the
 * enter and the exit direction.
 *
 * Detection: `BurgerArrowIcon` renders `<svg><defs><mask id="burger-arrow">
 * <g style="...rotate(Xdeg)...">`; that group's inline `rotate(Xdeg)` equals
 * `180 * iconProgress`, a direct read-out of the value under test. The sampler
 * records it every animation frame across the navigation and the tests assert it
 * never leaves the hamburger band (<= 15deg) on the tab-root side.
 *
 * Coverage: CALIBRATION (harness reach), REGRESSION (browser-back /search -> /),
 * INTERMITTENCY (a fresh-load loop; the icon must stay down on EVERY iteration),
 * ASYMMETRY (forward tap / -> /search), and DESTINATIONS (parametrized over the
 * three tab roots /, /activity, /messages/inbox).
 */

interface IconFrame {
	t: number;
	path: string;
	/** Inline `rotate(Xdeg)` of the mask group = 180 * iconProgress (the target).
	 * 0 = hamburger, 180 = back arrow. Null when the icon is not in the DOM. */
	targetRot: number | null;
	/** Computed (painted) rotation parsed from getComputedStyle's matrix, the
	 * actual on-screen rotation mid-transition. Null when unreadable. */
	paintedRot: number | null;
	/** Header search track translateX (px). ~0 at a tab root, ~-viewport-width in
	 * search. Corroborates that the scrub drove the search track. */
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
const HAMBURGER_BAND_DEG = 15;

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

/** Wait for the sampler rAF loop to run its full window (sets `done = true`). */
async function waitForIconSamplerDone(page: Page, timeoutMs = 3000): Promise<void> {
	await page.waitForFunction(
		() => (window as unknown as IconWindow).__iconLog?.done === true,
		{ timeout: timeoutMs }
	);
}

/** Max icon target rotation (deg) observed on `destPath` across the log. */
interface FlashSummary {
	maxTargetOnDest: number;
	maxPaintedOnDest: number;
	maxTargetOverall: number;
	destFrameCount: number;
	/** First dest frame whose target rotation left the hamburger band, if any. */
	firstFlashT: number | null;
	/** ms the target rotation stayed above 30deg on dest (the visible flash span). */
	flashSpanMs: number;
}

function summarizeFlash(log: IconFrame[], destPath: string): FlashSummary {
	let maxTargetOnDest = 0;
	let maxPaintedOnDest = 0;
	let maxTargetOverall = 0;
	let destFrameCount = 0;
	let firstFlashT: number | null = null;
	let lastFlashT: number | null = null;
	for (const f of log) {
		const t = f.targetRot ?? 0;
		if (t > maxTargetOverall) maxTargetOverall = t;
		if (f.path !== destPath) continue;
		destFrameCount++;
		if (t > maxTargetOnDest) maxTargetOnDest = t;
		const p = f.paintedRot ?? 0;
		if (p > maxPaintedOnDest) maxPaintedOnDest = p;
		if (t > 30) {
			if (firstFlashT === null) firstFlashT = f.t;
			lastFlashT = f.t;
		}
	}
	return {
		maxTargetOnDest,
		maxPaintedOnDest,
		maxTargetOverall,
		destFrameCount,
		firstFlashT,
		flashSpanMs: firstFlashT !== null && lastFlashT !== null ? lastFlashT - firstFlashT : 0
	};
}

/** Hard-load a tab root and wait for the SPA to be ready. */
async function loadTabRoot(page: Page, href: string): Promise<void> {
	await page.goto(href);
	await waitForHydration(page);
}

/** SPA-navigate to /search via the header search button. Assumes a tab root. */
async function enterSearch(page: Page): Promise<void> {
	await page.locator('header a[href="/search"][aria-label]').click();
	await page.waitForURL('**/search', { timeout: 8000 });
	// Let the entry scrub (orchestrator tap-scrub rAF) + the settle ease fully
	// settle so the back nav starts from the steady search state.
	await page.waitForTimeout(450);
}

/**
 * A warm-up back cycle from `destHref`. The title state machine can hold a
 * settle across the first /search -> dest back (Effect E's `if (settling) return`
 * guard then skips the scrub). Running one throwaway cycle over SPA nav (no hard
 * reload) idles the state machine so the instrumented back exercises the scrub
 * path deterministically. The invariant must hold on the first back AND on every
 * subsequent back, so the INTERMITTENCY test (no warm-up) is the stricter guard.
 */
async function warmUpFrom(page: Page, destHref: string): Promise<void> {
	await enterSearch(page);
	await page.goBack();
	await page.waitForURL(`**${destHref === '/' ? '/' : destHref}`, { timeout: 8000 });
	await page.waitForTimeout(500);
}

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

// CALIBRATION: prove the harness reaches /search, the browser back returns to /,
// and the sampler caught frames on both pages. If this fails the regression
// assertions below are meaningless (the back nav never landed, or the icon was
// never sampled on /).
test('CALIBRATION: / -> /search -> browser-back -> / reaches / with the icon sampler live', async ({
	page
}) => {
	await loadTabRoot(page, '/');
	await enterSearch(page);

	await installIconSampler(page);
	await page.goBack();
	await page.waitForURL('**/', { timeout: 8000 });
	await waitForIconSamplerDone(page);

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

// REGRESSION: on the browser back /search -> / the hamburger must stay a
// hamburger. The icon target rotation (180 * iconProgress) must remain in the
// hamburger band (<= 15deg) for every frame on /. The warm-up idles the title
// state machine first so the scrub path is exercised deterministically.
test('REGRESSION: browser-back /search -> / keeps the hamburger down (no arrow flash)', async ({
	page
}) => {
	await loadTabRoot(page, '/');
	await warmUpFrom(page, '/');
	await enterSearch(page);

	await installIconSampler(page);
	await page.goBack();
	await page.waitForURL('**/', { timeout: 8000 });
	// Capture through the ~200ms tap-scrub rAF + the orchestrator settle ease.
	await waitForIconSamplerDone(page);

	const log = await readIconLog(page);
	const s = summarizeFlash(log, '/');

	console.log(
		'BACK /search -> / summary:',
		`maxTargetOnDest=${s.maxTargetOnDest.toFixed(1)}deg`,
		`maxPaintedOnDest=${s.maxPaintedOnDest.toFixed(1)}deg`,
		`flashSpan=${s.flashSpanMs}ms`,
		`destFrames=${s.destFrameCount}`,
		s.firstFlashT !== null ? `firstFlash@${s.firstFlashT}ms` : 'noFlash'
	);

	expect(
		s.destFrameCount,
		'precondition: the sampler captured the icon on / after the back'
	).toBeGreaterThan(10);
	expect(
		s.maxTargetOnDest,
		`icon left the hamburger band on /search -> / back. ` +
			`maxTargetOnDest=${s.maxTargetOnDest.toFixed(1)}deg (180 = full arrow), ` +
			`maxPaintedOnDest=${s.maxPaintedOnDest.toFixed(1)}deg, ` +
			`flashSpan=${s.flashSpanMs}ms. ` +
			`The icon target rotation must stay <= ${HAMBURGER_BAND_DEG}deg the whole time.`
	).toBeLessThanOrEqual(HAMBURGER_BAND_DEG);
});

// INTERMITTENCY: the icon must stay down on EVERY iteration of a fresh-load
// loop, including the first back (which a lingering settle can make the scrub
// skip). Repeat the cycle from a fresh load and assert every iteration stays in
// the hamburger band.
test('INTERMITTENCY: every /search -> / back in a fresh-load loop keeps the hamburger down', async ({
	page
}) => {
	await loadTabRoot(page, '/');

	const perIterMax: number[] = [];
	const ITERS = 5;
	for (let i = 0; i < ITERS; i++) {
		await enterSearch(page);

		await installIconSampler(page);
		await page.goBack();
		await page.waitForURL('**/', { timeout: 8000 });
		await waitForIconSamplerDone(page);
		const log = await readIconLog(page);
		const s = summarizeFlash(log, '/');
		perIterMax.push(s.maxTargetOnDest);
	}

	console.log('per-iteration maxTargetOnDest (deg):', perIterMax.map((v) => v.toFixed(1)));

	expect(
		perIterMax.every((v) => v <= HAMBURGER_BAND_DEG),
		`icon left the band on ${perIterMax.filter((v) => v > HAMBURGER_BAND_DEG).length}/${ITERS} iterations. ` +
			`per-iter maxTargetOnDest=${perIterMax.map((v) => v.toFixed(1)).join(', ')}deg`
	).toBe(true);
});

// ASYMMETRY: the forward direction / -> /search must keep the hamburger down.
// `isSearch` flips true in the same flush as the scrub starts, so the freeze
// holds the icon at 0 throughout. Guards the forward side.
test('ASYMMETRY: forward tap / -> /search keeps the hamburger down', async ({ page }) => {
	await loadTabRoot(page, '/');

	await installIconSampler(page);
	await enterSearch(page);

	const log = await readIconLog(page);
	// The icon must stay a hamburger on / (pre-nav) AND on /search (post-nav).
	const maxTarget = log.reduce((m, f) => Math.max(m, f.targetRot ?? 0), 0);

	console.log(`FORWARD / -> /search maxTargetOverall=${maxTarget.toFixed(1)}deg`);

	expect(
		maxTarget,
		`forward / -> /search must keep the icon a hamburger (<= ${HAMBURGER_BAND_DEG}deg), got ${maxTarget.toFixed(1)}deg`
	).toBeLessThanOrEqual(HAMBURGER_BAND_DEG);
});

// DESTINATIONS: the freeze is destination-agnostic. Effect E fires the scrub on
// any currentHasTabs flip paired with an isSearch flip, so /search -> /activity
// and /search -> /messages/inbox traverse the same path as /search -> /. Each
// tab root is exercised: land on it, enter search, browser-back, assert the icon
// stays in the hamburger band on that destination.
test.describe('DESTINATIONS: /search -> each tab root keeps the hamburger down', () => {
	for (const dest of ['/activity', '/messages/inbox']) {
		test(`REGRESSION: browser-back /search -> ${dest} keeps the hamburger down`, async ({
			page
		}) => {
			await loadTabRoot(page, dest);
			await warmUpFrom(page, dest);
			await enterSearch(page);

			await installIconSampler(page);
			await page.goBack();
			await page.waitForURL(`**${dest}`, { timeout: 8000 });
			await waitForIconSamplerDone(page);

			const log = await readIconLog(page);
			const s = summarizeFlash(log, dest);

			console.log(
				`BACK /search -> ${dest} summary:`,
				`maxTargetOnDest=${s.maxTargetOnDest.toFixed(1)}deg`,
				`destFrames=${s.destFrameCount}`
			);

			expect(
				s.destFrameCount,
				`precondition: the sampler captured the icon on ${dest} after the back`
			).toBeGreaterThan(10);
			expect(
				s.maxTargetOnDest,
				`icon left the hamburger band on /search -> ${dest} back. ` +
					`maxTargetOnDest=${s.maxTargetOnDest.toFixed(1)}deg. ` +
					`The icon target rotation must stay <= ${HAMBURGER_BAND_DEG}deg.`
			).toBeLessThanOrEqual(HAMBURGER_BAND_DEG);
		});
	}
});

// No OVER-FREEZE e2e: a /search -> deep navigation within the ~200ms scrub
// window is the theoretical trajectory where a lingering scrub could freeze the
// icon at the hamburger on a deep page. Empirically (via `__headerMorphProbe`)
// the deep-page load lands AFTER the scrub completes (`morph` is already 0 on
// the first sampled frame), so `searchScrubbing` is false at landing and the
// icon correctly shows the arrow. The over-freeze is therefore practically
// unreachable through a real navigation, and a discriminator e2e cannot reliably
// catch the scrub in flight. The `currentHasTabs` gate in the `iconProgress`
// freeze (`isSearch || (searchScrubbing && currentHasTabs)`) is a defensive
// correctness refinement: it is sound by static reasoning (deep pages have
// `currentHasTabs === false`, so the scrub term does not freeze there) and is
// verified not to regress the DV13 flash fix by the suite above.
