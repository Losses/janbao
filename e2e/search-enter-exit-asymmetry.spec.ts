import { test, expect, type Page } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

/**
 * Search enter/exit animation - one search-progress timeline played forward
 * and reverse.
 *
 * SPEC (the scope-tab bar is attached to the search panel, so it arrives AFTER
 * and leaves BEFORE the panel):
 *   ENTER (tap search):  slide the track in, THEN expand the scope-tab bar.
 *   EXIT  (back-swipe):  collapse the scope-tab bar, THEN slide the track out.
 *
 * Both directions come from the SAME consumers of `searchProgress`
 * (HEADER_MORPH_THRESHOLD = 0.2):
 *   searchProgress (header track translateX + search button left) is LINEAR
 *                   over searchProgress in [0, 1]
 *   tabProgress    (SearchTabBar max-height) over searchProgress in [0.8, 1.0]
 *                  via `max(0, (searchProgress - (1 - HMT)) / HMT)`
 * A continuous searchProgress 0->1 (ENTER: tap) slides the track across the
 * whole range and expands the scope-tab bar only across the last 20%, so the
 * slide-then-expand asymmetry is structural in the consumer formulas. A
 * continuous searchProgress 1->0 (EXIT: back-swipe) collapses the scope-tab
 * bar across the first 20% then slides the track across the rest, so the
 * collapse-then-slide asymmetry is the same formula run in reverse. The two
 * are exact mirrors, so a single continuous search-progress timeline serves
 * both directions.
 *
 * The gesture exit scrubs `searchProgress` continuously: NavPipelineHost
 * publishes `pager.backMorph` 0->1 with the finger and the Header's
 * `searchProgress` / `trackMorph` derivations map it to the search-layout
 * position. The tap nav has no finger and no title change (/search has no
 * deep title, so the title-settle driver stays idle), so the orchestrator's
 * tap-scrub rAF drives the same timeline via `pager.tapMorph` (1->0 on
 * enter, 0->1 on exit) over ~200ms. The search consumers have no CSS
 * transition; they reactively follow `searchProgress` 1:1, as a drag does.
 *
 * The tests sample the header track translateX + the SearchTabBar max-height
 * (+ pager.backMorph) every frame and assert the spec for both directions:
 * ENTER slides before it expands, EXIT collapses before it slides. A regression
 * that reverts the tap-enter to a searchProgress jump (no continuous scrub)
 * makes the slide and expand run in parallel and fails the ENTER and MIRROR
 * tests.
 */

interface SearchHdrFrame {
	t: number;
	path: string;
	/** Header root<->search track translateX (px). ~0 at a tab root, ~-viewport-width in search. */
	trackTx: number | null;
	/** SearchTabBar wrapper max-height (px). 0 collapsed, ~48 (3rem) expanded. */
	tabMaxH: number | null;
	/** Search button viewport-left (px). Rightmost at a tab root, leftmost in search. */
	btnLeft: number | null;
	/** Primary pager store backMorph: 0..1 during any in-flight non-tab-to-tab
	 *  transition and at rest on a non-centerTab NavPipelineHost route; null at rest on a
	 *  centerTab route or a tab host and during tab-to-tab transitions. */
	backMorph: number | null;
	/** NavPipelineHost (content) track translateX (px) - the page-change signal on /search. */
	contentTx: number | null;
	/** Header rootLayer translateY (px) - the MobileTabBar Tab descent descent signal (DV17 NB27). */
	rootLayerY: number | null;
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
	/** When true, also sample the NavPipelineHost content track (.detail-scroll-pane parent). */
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
			const rootLayerEl = (): Element | null =>
				document.querySelector('header div.absolute.inset-0.flex.items-center.justify-center');
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
					contentTx: txOf(contentEl()),
					rootLayerY: (() => {
						const el = rootLayerEl();
						if (!el) return null;
						const tr = getComputedStyle(el).transform;
						if (tr === 'none') return 0;
						try {
							return new DOMMatrix(tr).m42;
						} catch {
							return null;
						}
					})()
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

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

// --- EXIT (back-swipe): collapse the scope-tab bar, THEN slide (REFERENCE) ---
// Currently correct: on EXIT the source is /search (isSearch = true) so
// searchProgress = 1 - trackMorph = 1 - pager.backMorph, running 1->0 as the
// swipe advances. tabProgress tracks searchProgress over [0.8, 1.0] (the
// first 20% of the EXIT), so the scope-tab bar collapses to ~0 while the
// header track (linear over searchProgress [0, 1]) is still >=60% slid.
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
// Guards the tap-scrub rAF in the orchestrator (publishing pager.tapMorph). A
// regression that reverts the tap-enter to a morph jump makes the track slide
// and the scope-tab bar expand land in the same flush, leaving no frame where
// the track has slid but the scope-tab bar has not yet expanded.
test('ENTER search via tap: track slides in BEFORE the scope-tab bar expands (spec: slide-then-expand)', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);

	await installSearchHdrSampler(page, { windowMs: 2500, withContent: true });
	await page.locator('header a[href="/search"][aria-label]').click();
	await page.waitForURL('/search', { timeout: 8000 });
	await page.waitForFunction(
		() => (window as unknown as SearchHdrWindow).__searchHdr?.done === true,
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

	// DV17 sync + CALIBRATION. The Header track and the Page panel both read
	// pager.tapMorph, so they move together. Assert their normalized progress
	// stays within a tight band across the active slide. CALIBRATION baseline:
	// a regression that drives the two from separate timings (the Header track
	// via the orchestrator's tap-scrub rAF, the Page panel via a separate
	// rAF channel) makes |trackNorm - pageNorm| peak mid-flight, failing the
	// <0.2 band. DV17 drives both from the linear tapMorph, giving
	// maxDelta ~0.000.
	const peakContent = Math.max(...searchFrames.map((f) => Math.abs(f.contentTx ?? 0)));
	const syncFrames = searchFrames.filter(
		(f) => f.contentTx !== null && Math.abs(f.contentTx ?? 0) > peakContent * 0.1
	);
	const maxDelta = syncFrames.length
		? Math.max(
				...syncFrames.map((f) => {
					const tn = peakTrack > 0 ? Math.abs(f.trackTx ?? 0) / peakTrack : 0;
					const pn = peakContent > 0 ? Math.abs(f.contentTx ?? 0) / peakContent : 0;
					return Math.abs(tn - pn);
				})
			)
		: 1;
	console.log('ENTER sync maxDelta:', maxDelta.toFixed(3), 'over', syncFrames.length, 'frames');
	expect(maxDelta, 'Header track and Page panel must move in sync (DV17 tapMorph)').toBeLessThan(0.2);
});

// --- DV17 tap-EXIT (/search -> / via popstate): Header track and Page panel sync pre-nav ---
test('DV17 tap-EXIT (/search -> /): Header track and Page panel move in sync pre-nav', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.locator('header a[href="/search"][aria-label]').click();
	await page.waitForURL('/search', { timeout: 8000 });
	await page.waitForTimeout(400); // let the entry settle

	await installSearchHdrSampler(page, { windowMs: 3000, withContent: true });
	await page.goBack();
	await page.waitForURL('/', { timeout: 8000 });
	await page.waitForFunction(
		() => (window as unknown as SearchHdrWindow).__searchHdr?.done === true,
		{ timeout: 6000 }
	);

	const frames = await readSearchHdrLog(page);
	// Pre-nav frames: still on /search (the GPL intercepts and animates before
	// the URL flips). The Header track and the Page panel both read pager.tapMorph
	// here and must move together.
	const preNavFrames = frames.filter((f) => f.path === '/search' && f.contentTx !== null);
	expect(preNavFrames.length, 'must capture pre-nav /search frames with content').toBeGreaterThan(5);

	const peakTrack = Math.max(...preNavFrames.map((f) => Math.abs(f.trackTx ?? 0)));
	const peakContent = Math.max(...preNavFrames.map((f) => Math.abs(f.contentTx ?? 0)));
	const syncFrames = preNavFrames.filter((f) => Math.abs(f.contentTx ?? 0) > peakContent * 0.1);
	const maxDelta = syncFrames.length
		? Math.max(
				...syncFrames.map((f) => {
					const tn = peakTrack > 0 ? Math.abs(f.trackTx ?? 0) / peakTrack : 0;
					const pn = peakContent > 0 ? Math.abs(f.contentTx ?? 0) / peakContent : 0;
					return Math.abs(tn - pn);
				})
			)
		: 1;
	console.log('tap-EXIT sync maxDelta:', maxDelta.toFixed(3), 'over', syncFrames.length, 'frames');
	expect(
		maxDelta,
		'Header track and Page panel must move in sync on tap-EXIT (DV17 tapMorph)'
	).toBeLessThan(0.2);
});

// --- DV17 NB27: MobileTabBar translateY trajectory on tap-EXIT (single post-nav descent) ---
test('DV17 NB27: MobileTabBar descends once post-nav on tap-EXIT (no pre-nav appear, no double)', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.locator('header a[href="/search"][aria-label]').click();
	await page.waitForURL('/search', { timeout: 8000 });
	await page.waitForTimeout(400);

	await installSearchHdrSampler(page, { windowMs: 3000, withContent: true });
	await page.goBack();
	await page.waitForURL('/', { timeout: 8000 });
	await page.waitForFunction(
		() => (window as unknown as SearchHdrWindow).__searchHdr?.done === true,
		{ timeout: 6000 }
	);

	const frames = await readSearchHdrLog(page);
	// Pre-nav (/search): isSearch=true freezes the rootLayer ('transform: none'),
	// so rootLayerY stays 0. The MobileTabBar is covered by the search layer and
	// never appears pre-nav. This also guards a regression that wired tapMorph
	// into rootLayerStyle: pre-nav tapMorph variation would drive a descent here.
	const preNav = frames.filter((f) => f.path === '/search' && f.rootLayerY !== null);
	const preNavMin = preNav.length ? Math.min(...preNav.map((f) => f.rootLayerY ?? 0)) : 0;
	console.log('NB27 pre-nav rootLayerY min:', preNavMin);
	expect(
		preNavMin,
		'no pre-nav MobileTabBar descent (rootLayer frozen in search mode)'
	).toBeGreaterThan(-10);

	// Post-nav (/): the layer group reads `morph`; the orchestrator's
	// settle ease (armed at the tap) drives it to 1, so rootLayerStyle
	// rests at translateY(0%) - MobileTabBar shown in place. Assert it
	// rests at 0 with no stuck/negative value.
	const postNav = frames.filter((f) => f.path === '/' && f.rootLayerY !== null);
	const postNavMin = postNav.length ? Math.min(...postNav.map((f) => f.rootLayerY ?? 0)) : 0;
	const lastY = postNav.length ? postNav[postNav.length - 1]?.rootLayerY ?? 0 : 0;
	console.log('NB27 post-nav rootLayerY min:', postNavMin, 'last:', lastY);
	expect(postNavMin, 'post-nav MobileTabBar rests at translateY 0 (no stuck)').toBeGreaterThan(-30);
	expect(Math.abs(lastY), 'post-nav MobileTabBar settles at translateY 0').toBeLessThan(30);
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
