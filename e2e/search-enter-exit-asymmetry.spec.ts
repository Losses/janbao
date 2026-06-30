import { test, expect, type Page } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

/**
 * Search entry/exit animation asymmetry.
 *
 * The Header's root<->search transition is driven by a single `morph` value,
 * consumed by two piecewise functions of `morph` (HEADER_MORPH_THRESHOLD = 0.2):
 *
 *   tabProgress    = isSearch ? 1 - min(1, morph / 0.2)          : 0   // SearchTabBar max-height
 *   searchProgress = isSearch ? 1 - clamp((morph-0.2)/0.8, 0, 1) : 0   // header track translateX
 *
 * These two occupy DISJOINT sub-ranges of morph: the scope-tab bar finishes its
 * whole collapse over morph in [0, 0.2], while the track slide does not even
 * start until morph = 0.2 and runs over [0.2, 1]. That sequencing is only
 * VISIBLE when `morph` is scrubbed continuously - which only the GESTURE path
 * does (GesturePageLayout writes pager.backMorph 0->1 with the finger).
 *
 * The TAP path does NOT scrub morph: /search has no deep title
 * (resolveDeepHeaderTitle('/search') === null) and its load returns no
 * `headerTitle`, so Header Effect C (title-change settle driver) never fires,
 * and `morph` simply JUMPS 1 -> 0 in one render when the SPA nav lands. The jump
 * hands every consumer its final value in the same flush, so each consumer's
 * independent CSS transition (`transform 200ms`, `max-height 200ms`, `left
 * 200ms`) fires together and they run in parallel.
 *
 * Net effect (the reported divergence):
 *   - ENTER (tap search): scope-tab bar expand + track slide START TOGETHER (parallel).
 *   - EXIT  (back-swipe): scope-tab bar collapses to ~0 while the track is still
 *     at the search position (sequenced), then the track continues.
 *
 * These are two different mechanisms producing the enter vs the exit, NOT one
 * animation played forward/reverse. The tests below sample the header track
 * translateX + the scope-tab bar max-height (+ pager.backMorph) every frame and
 * assert both halves of the divergence, then assert they are not mirrors.
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

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

// --- ENTER (tap): scope-tab bar + track slide START TOGETHER (parallel) ------
test('ENTER search via tap: scope-tab bar expand and track slide start in lockstep (parallel)', async ({
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

	// Restrict to the entry transition: frames at/after the first frame on /search.
	const searchFrames = frames.filter((f) => f.path === '/search');
	expect(searchFrames.length, 'must capture frames after landing on /search').toBeGreaterThan(5);

	const firstMoved = (key: (f: SearchHdrFrame) => number | null, origin: number): number => {
		const i = searchFrames.findIndex((f) => {
			const v = key(f);
			return v !== null && Math.abs(v - origin) > 1;
		});
		return i >= 0 ? searchFrames[i].t : Number.POSITIVE_INFINITY;
	};

	// Origins on '/': trackTx=0, tabMaxH=0, btnLeft=rightmost. The three
	// consumers should all leave their origin in the SAME render flush.
	const trackStart = firstMoved((f) => f.trackTx, 0);
	const tabStart = firstMoved((f) => f.tabMaxH, 0);
	const btnStart = firstMoved((f) => f.btnLeft, searchFrames[0].btnLeft ?? 0);

	console.log('ENTER start times (ms since sampler install):', {
		trackStart,
		tabStart,
		btnStart
	});

	// Parallel start: all three consumers begin within one render of each other.
	// 60ms = ~4 rAF frames of slack for the SPA-nav flush + first paint.
	expect(Math.abs(trackStart - tabStart), 'track and scope-tab bar must start together').toBeLessThan(
		60
	);
	expect(Math.abs(trackStart - btnStart), 'track and search button must start together').toBeLessThan(
		60
	);

	// Lockstep progress: at the frame where the scope-tab bar is half-expanded,
	// the track must also be roughly half-slid (their normalized progress tracks
	// within ~25%). This is the hallmark of "one shared jump driving parallel CSS
	// transitions with identical 200ms ease-out timing".
	const peakTab = Math.max(
		...searchFrames.map((f) => f.tabMaxH ?? 0)
	);
	const peakTrack = Math.max(
		...searchFrames.map((f) => Math.abs(f.trackTx ?? 0))
	);
	expect(peakTab, 'scope-tab bar must expand during entry').toBeGreaterThan(20);
	expect(peakTrack, 'header track must slide during entry').toBeGreaterThan(100);

	const halfTabFrame = searchFrames.find((f) => (f.tabMaxH ?? 0) >= peakTab * 0.45);
	expect(halfTabFrame, 'must capture the scope-tab bar at ~half expansion').toBeTruthy();
	if (halfTabFrame) {
		const tabNorm = (halfTabFrame.tabMaxH ?? 0) / peakTab;
		const trackNorm = Math.abs(halfTabFrame.trackTx ?? 0) / peakTrack;
		console.log('ENTER lockstep at half-tab:', { tabNorm, trackNorm });
		expect(Math.abs(tabNorm - trackNorm), 'normalized progress must be lockstep').toBeLessThan(0.3);
	}
});

// --- EXIT (back-swipe): scope-tab bar collapses BEFORE the track slides ------
test('EXIT search via back-swipe: scope-tab bar collapses to ~0 while the track is still at the search position (sequenced)', async ({
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

	// The divergence window: frames during the drag where backMorph has entered
	// (0.15, 0.55) - past the 0.2 threshold where tabProgress has saturated but
	// searchProgress has only just begun to move.
	const peakTrack = Math.max(
		...frames.map((f) => Math.abs(f.trackTx ?? 0))
	);
	const peakTab = Math.max(...frames.map((f) => f.tabMaxH ?? 0));

	// Sequencing proof: there must exist a drag frame where the scope-tab bar is
	// essentially collapsed (<=15% of peak) but the header track has barely moved
	// from its search position (still >=60% of peak). That state is impossible if
	// the exit were the reverse of the (lockstep) enter.
	const desyncFrame = frames.find((f) => {
		const morph = f.backMorph;
		if (morph === null || morph < 0.15 || morph > 0.6) return false;
		const tabNorm = peakTab > 0 ? (f.tabMaxH ?? 0) / peakTab : 0;
		const trackNorm = peakTrack > 0 ? Math.abs(f.trackTx ?? 0) / peakTrack : 0;
		return tabNorm <= 0.15 && trackNorm >= 0.6;
	});

	console.log(
		'EXIT desync (scope-tab collapsed while track held):',
		desyncFrame
			? `t=${desyncFrame.t}ms morph=${desyncFrame.backMorph?.toFixed(2)} tabNorm=${((desyncFrame.tabMaxH ?? 0) / peakTab).toFixed(2)} trackNorm=${(Math.abs(desyncFrame.trackTx ?? 0) / peakTrack).toFixed(2)}`
			: 'NOT FOUND'
	);

	expect(desyncFrame, 'scope-tab bar must collapse before the track slides back').toBeTruthy();
});

// --- The divergence itself: enter is NOT the mirror of exit ------------------
test('DIVIDER: enter is lockstep but exit is sequenced (not one animation forward/reverse)', async ({
	page
}) => {
	// Re-derive a compact summary from both transitions in one place so the
	// report has a single side-by-side comparison. The two halves are exercised
	// by the tests above; this test recomputes the two key timings and asserts
	// they differ in character (parallel start vs sequenced completion).

	await page.goto('/');
	await waitForHydration(page);

	// ENTER sample.
	await installSearchHdrSampler(page, { windowMs: 2000, withContent: false });
	await page.locator('header a[href="/search"][aria-label]').click();
	await page.waitForURL('/search', { timeout: 8000 });
	await page.waitForFunction(
		() => (window as unknown as SearchHdrWindow).__searchHdr?.done === true,
		{ timeout: 6000 }
	);
	const enterFrames = (await readSearchHdrLog(page)).filter((f) => f.path === '/search');
	const enterTrackStart = enterFrames.find((f) => Math.abs(f.trackTx ?? 0) > 1)?.t ?? null;
	const enterTabStart = enterFrames.find((f) => (f.tabMaxH ?? 0) > 1)?.t ?? null;
	const enterStartGap =
		enterTrackStart !== null && enterTabStart !== null
			? Math.abs(enterTrackStart - enterTabStart)
			: null;

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
	const peakTab = Math.max(...exitFrames.map((f) => f.tabMaxH ?? 0));
	const peakTrack = Math.max(...exitFrames.map((f) => Math.abs(f.trackTx ?? 0)));
	// On exit, the scope-tab bar reaches <=15% of peak while the track is still
	// >=60% of peak - the order they COMPLETE is reversed relative to a mirror.
	const exitDesync = exitFrames.some((f) => {
		const m = f.backMorph;
		if (m === null || m < 0.15 || m > 0.6) return false;
		const tabNorm = peakTab > 0 ? (f.tabMaxH ?? 0) / peakTab : 0;
		const trackNorm = peakTrack > 0 ? Math.abs(f.trackTx ?? 0) / peakTrack : 0;
		return tabNorm <= 0.15 && trackNorm >= 0.6;
	});

	console.log('DIVERGENCE SUMMARY:', {
		enterStartGapMs: enterStartGap,
		enterParallel: (enterStartGap ?? 999) < 60,
		exitSequenced: exitDesync
	});

	expect(enterStartGap, 'enter must start in lockstep').not.toBeNull();
	expect((enterStartGap ?? 999) < 60, 'enter: track and scope-tab bar start together').toBe(true);
	expect(exitDesync, 'exit: scope-tab bar collapses before the track slides').toBe(true);
	// The two characters are mutually exclusive for a single reversible animation.
	expect(
		(enterStartGap ?? 999) < 60 && exitDesync,
		'enter is parallel AND exit is sequenced => not one animation forward/reverse'
	).toBe(true);
});
