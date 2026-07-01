import { test, expect, type Page } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

/**
 * Search enter/exit animation - one morph timeline played forward and reverse.
 *
 * SPEC (the scope-tab bar is attached to the search panel, so it arrives AFTER
 * and leaves BEFORE the panel):
 *   ENTER (tap search):  slide the track in, THEN expand the scope-tab bar.
 *   EXIT  (back-swipe):  collapse the scope-tab bar, THEN slide the track out.
 *
 * Both directions come from the SAME piecewise consumers of `morph`
 * (HEADER_MORPH_THRESHOLD = 0.2):
 *   tabProgress    (SearchTabBar max-height) over morph in [0, 0.2]
 *   searchProgress (header track translateX) over morph in [0.2, 1]
 * A continuous morph 0->1 collapses the tab first then slides; a continuous
 * morph 1->0 slides first then expands the tab. The two are exact mirrors, so a
 * single continuous morph timeline serves both directions.
 *
 * The gesture exit scrubs `morph` continuously: GesturePageLayout writes
 * pager.backMorph 0->1 with the finger and Header `morph` reads it. The tap nav
 * has no finger and no title change (/search has no deep title, so the
 * title-settle driver stays idle), so Header.startSearchScrub drives the same
 * timeline with a rAF (1->0 on enter, 0->1 on exit) over ~200ms. While it runs,
 * the search consumers drop their CSS transition and follow `morph` 1:1, as a
 * drag does.
 *
 * The tests sample the header track translateX + the SearchTabBar max-height
 * (+ pager.backMorph) every frame and assert the spec for both directions:
 * ENTER slides before it expands, EXIT collapses before it slides. A regression
 * that reverts the tap-enter to a morph jump (no continuous scrub) makes the
 * slide and expand run in parallel and fails the ENTER and MIRROR tests.
 */

interface SearchHdrFrame {
	t: number;
	path: string;
	/** Header root<->search track translateX (px). ~0 at a tab root, ~-half-viewport in search. */
	trackTx: number | null;
	/** SearchTabBar wrapper max-height (px). 0 collapsed, ~48 (3rem) expanded. */
	tabMaxH: number | null;
	/** Search button viewport-left (px). Rightmost at a tab root, leftmost in search. */
	btnLeft: number | null;
	/** Primary pager store backMorph (0..1, or null when no swipe-back is in progress). */
	backMorph: number | null;
	/** GesturePageLayout (content) track translateX (px) - the page-change signal on /search. */
	contentTx: number | null;
}

interface SearchHdrLog {
	frames: SearchHdrFrame[];
	done: boolean;
}

interface SearchHdrWindow extends Window {
	__searchHdr?: SearchHdrLog;
}

interface SamplerOpts {
	windowMs: number;
	/** When true, also sample the GesturePageLayout content track (.detail-scroll-pane parent). */
	withContent: boolean;
}

async function installSearchHdrSampler(page: Page, opts: SamplerOpts): Promise<void> {
	await page.evaluate(
		({ windowMs, withContent }) => {
			const w = window as unknown as SearchHdrWindow;
			const log: SearchHdrLog = { frames: [], done: false };
			w.__searchHdr = log;
			const txOf = (el: Element | null): number | null => {
				if (!el) return null;
				try {
					return new DOMMatrix(getComputedStyle(el).transform).m41;
				} catch {
					return null;
				}
			};
			const trackEl = (): Element | null =>
				document.querySelector('header div.flex.w-\\[200\\%\\]');
			const tabWrapEl = (): Element | null => {
				// The scope-tab <button data-scope-tab> -> nav -> overflow-hidden wrapper.
				const btn = document.querySelector('[data-scope-tab]');
				return btn ? btn.closest('nav')?.parentElement ?? null : null;
			};
			// [aria-label] picks the MOBILE search button (the desktop nav link shares
			// the href but is `hidden md:flex` -> display:none on mobile, would yield
			// zero rects and a wrong first-match in querySelector).
			const btnEl = (): Element | null =>
				document.querySelector('header a[href="/search"][aria-label]');
			const contentEl = (): Element | null =>
				withContent ? document.querySelector('.detail-scroll-pane')?.parentElement ?? null : null;
			const start = performance.now();
			const tick = (): void => {
				const pp = (window as unknown as { __primaryPager?: { backMorph: number | null } })
					.__primaryPager;
				log.frames.push({
					t: Math.round(performance.now() - start),
					path: location.pathname,
					trackTx: txOf(trackEl()),
					tabMaxH: (() => {
						const el = tabWrapEl();
						return el ? parseFloat(getComputedStyle(el).maxHeight) : null;
					})(),
					btnLeft: (() => {
						const el = btnEl();
						return el ? Math.round((el as HTMLElement).getBoundingClientRect().left) : null;
					})(),
					backMorph: pp ? pp.backMorph : null,
					contentTx: txOf(contentEl())
				});
				if (performance.now() - start > windowMs) {
					log.done = true;
					return;
				}
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		},
		opts
	);
}

async function readSearchHdrLog(page: Page): Promise<SearchHdrFrame[]> {
	return page.evaluate(() => {
		const log = (window as unknown as SearchHdrWindow).__searchHdr;
		return log ? log.frames : [];
	});
}

/** Drive a slow rightward (back-swipe) touch gesture via CDP so the rAF sampler
 *  captures mid-drag frames. Starts inside the (40, width-40) edge dead-zone. */
async function slowSwipeBack(page: Page, startX: number, endX: number): Promise<void> {
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const y = 400;
	const steps = 28;
	const dispatch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string
	): Promise<unknown> =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});
	await dispatch('touchStart', startX, 'touchPressed');
	await page.waitForTimeout(40);
	for (let i = 1; i <= steps; i++) {
		const x = Math.round(startX + (endX - startX) * (i / steps));
		await dispatch('touchMove', x, 'touchMoved');
		await page.waitForTimeout(28);
	}
	await dispatch('touchEnd', endX, 'touchReleased');
	await client.detach();
}

/** Normalized progress of `vals` toward `peak`, in [0,1]. */
function norm(vals: number[], peak: number): number[] {
	return vals.map((v) => (peak > 0 ? Math.min(1, Math.max(0, v / peak)) : 0));
}

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

// --- EXIT (back-swipe): collapse the scope-tab bar, THEN slide (REFERENCE) ---
// Currently correct: morph is scrubbed 0->1 by pager.backMorph, so tabProgress
// (morph [0,0.2]) finishes before searchProgress (morph [0.2,1]) starts.
test('EXIT search via back-swipe: scope-tab bar collapses to ~0 while the track is still at the search position (reference, correct)', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.locator('header a[href="/search"][aria-label]').click();
	await page.waitForURL('/search', { timeout: 8000 });
	await page.waitForTimeout(400); // let the entry transition fully settle

	// Pre-condition: we are in search mode (track slid, scope-tab bar expanded).
	const pre = await page.evaluate(() => {
		const track = document.querySelector('header div.flex.w-\\[200\\%\\]');
		const btn = document.querySelector('[data-scope-tab]');
		const wrap = btn ? (btn.closest('nav')?.parentElement ?? null) : null;
		return {
			trackTx: track ? new DOMMatrix(getComputedStyle(track).transform).m41 : null,
			tabMaxH: wrap ? parseFloat(getComputedStyle(wrap).maxHeight) : null
		};
	});
	expect(pre.trackTx && Math.abs(pre.trackTx), 'pre: track must be slid into search').toBeGreaterThan(
		100
	);
	expect(pre.tabMaxH, 'pre: scope-tab bar must be expanded').toBeGreaterThan(20);

	await installSearchHdrSampler(page, { windowMs: 3000, withContent: true });

	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.3);
	const endX = Math.min(width - 50, startX + 260); // rightward back-swipe, inside the right edge
	await slowSwipeBack(page, startX, endX);

	await page.waitForURL('/', { timeout: 8000 });
	await page.waitForFunction(
		() => (window as unknown as SearchHdrWindow).__searchHdr?.done === true,
		{ timeout: 6000 }
	);

	const frames = await readSearchHdrLog(page);
	expect(frames.length, 'sampler must capture frames across the swipe').toBeGreaterThan(30);

	const peakTrack = Math.max(...frames.map((f) => Math.abs(f.trackTx ?? 0)));
	const peakTab = Math.max(...frames.map((f) => f.tabMaxH ?? 0));

	// Collapse-before-slide: a drag frame where the scope-tab bar is essentially
	// collapsed (<=15% of peak) but the header track is still at the search
	// position (>=60% of peak). backMorph in (0.15, 0.6) = the threshold window.
	const desyncFrame = frames.find((f) => {
		const morph = f.backMorph;
		if (morph === null || morph < 0.15 || morph > 0.6) return false;
		const tabNorm = peakTab > 0 ? (f.tabMaxH ?? 0) / peakTab : 0;
		const trackNorm = peakTrack > 0 ? Math.abs(f.trackTx ?? 0) / peakTrack : 0;
		return tabNorm <= 0.15 && trackNorm >= 0.6;
	});

	console.log(
		'EXIT collapse-before-slide:',
		desyncFrame
			? `t=${desyncFrame.t}ms morph=${desyncFrame.backMorph?.toFixed(2)} tabNorm=${((desyncFrame.tabMaxH ?? 0) / peakTab).toFixed(2)} trackNorm=${(Math.abs(desyncFrame.trackTx ?? 0) / peakTrack).toFixed(2)}`
			: 'NOT FOUND'
	);

	expect(desyncFrame, 'scope-tab bar must collapse before the track slides back').toBeTruthy();
});

// --- ENTER (tap): slide the track in, THEN expand the scope-tab bar (SPEC) ---
// Guards the rAF scrub in Header.startSearchScrub. A regression that reverts
// the tap-enter to a morph jump makes the track slide and the scope-tab bar
// expand fire their CSS transitions in parallel, leaving no frame where the
// track has slid but the scope-tab bar has not yet expanded.
test('ENTER search via tap: track slides in BEFORE the scope-tab bar expands (spec: slide-then-expand)', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);

	await installSearchHdrSampler(page, { windowMs: 2500, withContent: false });
	await page.locator('header a[href="/search"][aria-label]').click();
	await page.waitForURL('/search', { timeout: 8000 });
	await page.waitForFunction(
		(w) => (window as unknown as SearchHdrWindow).__searchHdr?.done === true,
		{},
		{ timeout: 6000 }
	);

	const frames = await readSearchHdrLog(page);
	expect(frames.length, 'sampler must capture frames across the entry').toBeGreaterThan(20);

	// Restrict to the entry transition: frames at/after landing on /search.
	const searchFrames = frames.filter((f) => f.path === '/search');
	expect(searchFrames.length, 'must capture frames after landing on /search').toBeGreaterThan(5);

	const peakTrack = Math.max(...searchFrames.map((f) => Math.abs(f.trackTx ?? 0)));
	const peakTab = Math.max(...searchFrames.map((f) => f.tabMaxH ?? 0));
	expect(peakTrack, 'header track must slide during entry').toBeGreaterThan(100);
	expect(peakTab, 'scope-tab bar must expand during entry').toBeGreaterThan(20);

	// Slide-before-expand: a frame where the track has substantially slid
	// (>=60% of peak) but the scope-tab bar has barely expanded (<=15% of peak).
	// Under a regression to a morph jump the two progress values are ~equal at
	// every frame, so no such frame exists.
	const slideFirstFrame = searchFrames.find((f) => {
		const trackNorm = peakTrack > 0 ? Math.abs(f.trackTx ?? 0) / peakTrack : 0;
		const tabNorm = peakTab > 0 ? (f.tabMaxH ?? 0) / peakTab : 0;
		return trackNorm >= 0.6 && tabNorm <= 0.15;
	});

	console.log(
		'ENTER slide-before-expand:',
		slideFirstFrame
			? `t=${slideFirstFrame.t}ms trackNorm=${(Math.abs(slideFirstFrame.trackTx ?? 0) / peakTrack).toFixed(2)} tabNorm=${((slideFirstFrame.tabMaxH ?? 0) / peakTab).toFixed(2)}`
			: 'NOT FOUND (parallel - regression)'
	);

	expect(
		slideFirstFrame,
		'track must slide in before the scope-tab bar expands'
	).toBeTruthy();
});

// --- MIRROR: enter is slide-first AND exit is collapse-first (one animation) ---
test('MIRROR: enter slides-then-expands and exit collapses-then-slides (one animation forward/reverse)', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);

	// ENTER sample.
	await installSearchHdrSampler(page, { windowMs: 2500, withContent: false });
	await page.locator('header a[href="/search"][aria-label]').click();
	await page.waitForURL('/search', { timeout: 8000 });
	await page.waitForFunction(
		() => (window as unknown as SearchHdrWindow).__searchHdr?.done === true,
		{ timeout: 6000 }
	);
	const enterFrames = (await readSearchHdrLog(page)).filter((f) => f.path === '/search');
	const enterPeakTrack = Math.max(...enterFrames.map((f) => Math.abs(f.trackTx ?? 0)));
	const enterPeakTab = Math.max(...enterFrames.map((f) => f.tabMaxH ?? 0));
	const enterSlideFirst = enterFrames.some((f) => {
		const trackNorm = enterPeakTrack > 0 ? Math.abs(f.trackTx ?? 0) / enterPeakTrack : 0;
		const tabNorm = enterPeakTab > 0 ? (f.tabMaxH ?? 0) / enterPeakTab : 0;
		return trackNorm >= 0.6 && tabNorm <= 0.15;
	});

	// EXIT sample.
	await page.waitForTimeout(300);
	await installSearchHdrSampler(page, { windowMs: 3000, withContent: false });
	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.3);
	await slowSwipeBack(page, startX, Math.min(width - 50, startX + 260));
	await page.waitForURL('/', { timeout: 8000 });
	await page.waitForFunction(
		() => (window as unknown as SearchHdrWindow).__searchHdr?.done === true,
		{ timeout: 6000 }
	);
	const exitFrames = await readSearchHdrLog(page);
	const exitPeakTrack = Math.max(...exitFrames.map((f) => Math.abs(f.trackTx ?? 0)));
	const exitPeakTab = Math.max(...exitFrames.map((f) => f.tabMaxH ?? 0));
	const exitCollapseFirst = exitFrames.some((f) => {
		const m = f.backMorph;
		if (m === null || m < 0.15 || m > 0.6) return false;
		const tabNorm = exitPeakTab > 0 ? (f.tabMaxH ?? 0) / exitPeakTab : 0;
		const trackNorm = exitPeakTrack > 0 ? Math.abs(f.trackTx ?? 0) / exitPeakTrack : 0;
		return tabNorm <= 0.15 && trackNorm >= 0.6;
	});

	console.log('MIRROR SUMMARY:', { enterSlideFirst, exitCollapseFirst });

	expect(exitCollapseFirst, 'exit: scope-tab bar collapses before the track slides').toBe(true);
	expect(enterSlideFirst, 'enter: track slides before the scope-tab bar expands').toBe(true);
});
