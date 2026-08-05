import { test, expect, type Page } from '@playwright/test';
import {
	prepareContext,
	waitForHydration,
	clickDiscussion,
	openSidebarAndGoto,
	installMultiSignalSampler,
	waitForMultiSignalDone,
	readMultiSignalFrames,
	slowTouchDrag,
	analyzeAnimation,
	signalRange,
	type MultiSignalFrame
} from './helpers';

// DV20 regressions: drag/header animation sync, the post-release curve, and the
// settings back-button phasing. These assert the DV20 §5 invariant (every
// visual is a pure function of the one published progress, written
// synchronously per pointermove during a drag and via the settle rAF after
// release) against the reported regressions:
//   1. During a held back-swipe the header morph (tab-bar root layer, title
//      layer, burger icon) must track the finger frame by frame. The regression
//      freezes the header for the whole drag and only animates it on release.
//   2. The post-release commit slide must be a smooth ease-out within the
//      spec clamp, not a sluggish / wrong-curve slide.
//   6. A held back-swipe on /profile/settings must sync EVERY header signal
//      with the finger (not only the burger) and must not jank.
//   7. The settings back-button must play the page slide and the header
//      bar-switch CONCURRENTLY (one animation), not as two sequential phases,
//      and the header animation must not jank.
//
// The multi-signal sampler (helpers.ts) records the header root layer
// translateY (rootLayerTy), the title layer translateY (deepLayerTy), the
// BurgerArrowIcon rotation (burgerRot), the NavPipelineHost track translateX
// (deepTrackTx), and the primary pager store's backMorph every rAF frame.

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

async function enterThread(page: Page): Promise<void> {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	await clickDiscussion(page, 0);
	await page.waitForURL(/\/discussion\//);
	await page.waitForSelector('.detail-scroll-pane');
	await page.waitForTimeout(500);
}

async function enterSettings(page: Page): Promise<void> {
	// Enter via the sidebar/goto hook (the user's "from home / sidebar" entry),
	// so the back-stack precondition matches a real deep-link arrival.
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	await openSidebarAndGoto(page, '/profile/settings');
	await page.waitForSelector('.detail-scroll-pane');
	await page.waitForTimeout(500);
}

// --- Bug 1 ------------------------------------------------------------------
// HELD back-swipe on a thread (finger down, no release). During the drag the
// page track follows the finger (that is the drag). The header morph signals
// must move IN SYNC with the finger on every frame; the regression defers all
// header animation to the release, so the held-drag frames show the header
// frozen while the track moves.
test('Bug 1: held back-swipe on a thread drives the header morph DURING the drag', async ({
	page
}) => {
	await enterThread(page);
	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.3);
	const endX = startX + 180; // past HEADER_MORPH_THRESHOLD; held so it never commits

	await installMultiSignalSampler(page, 2500);
	await slowTouchDrag(page, { startX, endX, hold: true, holdMs: 600, steps: 22, stepDelayMs: 30 });
	await waitForMultiSignalDone(page);
	const frames = await readMultiSignalFrames(page);
	expect(frames.length, 'sampler must capture held-drag frames').toBeGreaterThan(20);

	const track = signalRange(frames, (f) => f.deepTrackTx);
	const root = signalRange(frames, (f) => f.rootLayerTy);
	const deep = signalRange(frames, (f) => f.deepLayerTy);
	const burger = signalRange(frames, (f) => f.burgerRot);

	console.log('Bug1 held-drag ranges:', {
		deepTrackTx: track,
		rootLayerTy: root,
		deepLayerTy: deep,
		burgerRot: burger
	});

	// The gesture engaged: the deep-page track followed the finger. The
	// orchestrator publishes a live `backMorph` for every claimed drag on a
	// NavPipelineHost route (deep page, compose, and centerTab threads alike)
	// except a non-centerTab tab-to-tab swipe (the offline LIST mirror routes
	// `/offline`, `/offline/activity`, `/offline/bookmarks` null `backMorph`
	// end to end),
	// so the multi-signal sampler's `backMorph` channel is non-null here; the
	// track translateX is the engagement signal for Bug 1 because the
	// centerTab route's track reads `publication.progress` directly off the
	// executor, independent of the morph publication the Header consumes.
	expect(track.range, 'the deep-page track must follow the finger during the drag (gesture engaged)').toBeGreaterThan(
		50
	);

	// The header morph must move DURING the drag, in sync with the finger. A
	// regression that defers header animation to the release leaves these
	// frozen across every held-drag frame (range ~0).
	expect(
		root.range,
		'tab-bar root layer must descend with the finger during the drag (not deferred to release)'
	).toBeGreaterThan(5);
	expect(
		deep.range,
		'title layer must move with the finger during the drag (not deferred to release)'
	).toBeGreaterThan(5);
	expect(
		burger.range,
		'burger/arrow icon must morph with the finger during the drag (not deferred to release)'
	).toBeGreaterThan(15);
});

// --- Bug 2 ------------------------------------------------------------------
// Isolated COMMIT slide. A fast flick (high release velocity, set via explicit
// CDP timestamps) must yield a SHORT velocity-matched commit near
// COMMIT_T_MIN_MS (100ms), not a sluggish slide that maxes COMMIT_T_MAX_MS
// (600ms). The release instant is marked so the analysis covers ONLY the
// post-release commit, not the finger-paced drag. The commit must also be a
// smooth, decelerating (ease-out) slide.
interface Bug2Window extends Window {
	__bug2?: {
		frames: { t: number; tx: number }[];
		releaseT: number | null;
		start: number;
		done: boolean;
	};
}
test('Bug 2: a fast back-swipe release yields a short smooth ease-out commit (not sluggish)', async ({
	page
}) => {
	await enterThread(page);

	await page.evaluate(() => {
		const w = window as unknown as Bug2Window;
		w.__bug2 = { frames: [], releaseT: null, start: performance.now(), done: false };
		const tick = (): void => {
			const centre = document.querySelector('.detail-scroll-pane');
			const track = centre ? centre.parentElement : null;
			let tx = 0;
			if (track) {
				try {
					tx = new DOMMatrix(getComputedStyle(track).transform).m41;
				} catch {
					tx = 0;
				}
			}
			const s = (window as unknown as Bug2Window).__bug2!;
			s.frames.push({ t: performance.now() - s.start, tx: Math.round(tx) });
			if (performance.now() - s.start > 1800) {
				s.done = true;
				return;
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});

	// Fast flick: 4ms touchmove spacing produces a high release velocity.
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const y = 400;
	const startX = Math.round(width * 0.3);
	const endX = startX + 260;
	const originSec = Date.now() / 1000;
	const stepSec = 0.004;
	const stepCount = 14;
	const disp = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string,
		tSec: number
	): Promise<unknown> =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: originSec + tSec
		});
	await disp('touchStart', startX, 'touchPressed', 0);
	for (let i = 1; i <= stepCount; i++) {
		await disp(
			'touchMove',
			Math.round(startX + (endX - startX) * (i / stepCount)),
			'touchMoved',
			i * stepSec
		);
	}
	await page.evaluate(() => {
		const s = (window as unknown as Bug2Window).__bug2!;
		s.releaseT = performance.now() - s.start;
	});
	await disp('touchEnd', endX, 'touchReleased', stepCount * stepSec);
	await client.detach();
	await page.waitForURL('/', { timeout: 5000 });
	await page.waitForFunction(() => (window as unknown as Bug2Window).__bug2?.done === true, {
		timeout: 6000
	});

	const data = (await page.evaluate(() => (window as unknown as Bug2Window).__bug2!))!;
	const commit = analyzeAnimation(
		data.frames.filter((f) => f.t >= (data.releaseT ?? 0)).map((f) => ({ t: f.t, value: f.tx }))
	);
	console.log('Bug2 fast-flick commit (post-release):', commit);

	expect(commit.travel, 'commit slide must cover real distance').toBeGreaterThan(80);
	expect(
		commit.movingFrameCount,
		'commit must animate across multiple frames (not a 1-2 frame snap)'
	).toBeGreaterThanOrEqual(4);
	// A fast flick must produce a SHORT commit near COMMIT_T_MIN_MS. A sluggish
	// regression (e.g. velocity matching broken so every commit maxes the clamp)
	// lands near COMMIT_T_MAX_MS (600).
	expect(
		commit.durationMs,
		`fast-flick commit must be short, not sluggish (got ${commit.durationMs}ms; near 600 = sluggish)`
	).toBeLessThan(350);
	// Ease-out: front-loaded motion. A linear / accelerating curve (the
	// wrong-curve regression) drives deceleration toward zero or below.
	expect(
		commit.deceleration,
		'commit must decelerate (ease-out), not run linear / accelerating (sluggish curve)'
	).toBeGreaterThan(0);
});

// --- Bug 6 ------------------------------------------------------------------
// HELD back-swipe on /profile/settings (entered via the sidebar). Every header
// signal must sync with the finger, not only the burger icon. Plus the drag
// must not jank (the user reports the header animation performs very poorly).
test('Bug 6: held back-swipe on /profile/settings syncs every header signal (not only the burger) and does not jank', async ({
	page
}) => {
	await enterSettings(page);
	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.3);
	const endX = startX + 180;

	await installMultiSignalSampler(page, 2500);
	await slowTouchDrag(page, { startX, endX, hold: true, holdMs: 600, steps: 22, stepDelayMs: 30 });
	await waitForMultiSignalDone(page);
	const frames = await readMultiSignalFrames(page);
	expect(frames.length, 'sampler must capture held-drag frames').toBeGreaterThan(20);

	const morph = signalRange(frames, (f) => f.backMorph);
	const track = signalRange(frames, (f) => f.deepTrackTx);
	const root = signalRange(frames, (f) => f.rootLayerTy);
	const deep = signalRange(frames, (f) => f.deepLayerTy);
	const burger = signalRange(frames, (f) => f.burgerRot);

	console.log('Bug6 settings held-drag ranges:', {
		backMorph: morph,
		deepTrackTx: track,
		rootLayerTy: root,
		deepLayerTy: deep,
		burgerRot: burger
	});

	expect(morph.range, 'backMorph must advance during the held drag').toBeGreaterThan(0.15);
	expect(track.range, 'the deep-page track must follow the finger during the drag').toBeGreaterThan(50);

	// The regression syncs only the burger; the tab-bar root layer and title
	// layer stay frozen during the drag. All three must move with the finger.
	expect(
		root.range,
		'tab-bar root layer must sync with the finger (regression: only the burger syncs)'
	).toBeGreaterThan(5);
	expect(
		deep.range,
		'title layer must sync with the finger (regression: only the burger syncs)'
	).toBeGreaterThan(5);
	expect(burger.range, 'burger/arrow icon must morph with the finger').toBeGreaterThan(15);

	// Jank: the rAF cadence during the active drag must stay smooth. Severe
	// frame-drop (the reported "very poor performance") shows up as long rAF
	// intervals while the track is moving.
	const cadence = analyzeAnimation(
		frames.map((f) => ({ t: f.t, value: f.deepTrackTx }))
	);
	console.log('Bug6 drag cadence:', {
		meanIntervalMs: cadence.meanIntervalMs,
		maxIntervalMs: cadence.maxIntervalMs,
		movingFrames: cadence.movingFrameCount
	});
	expect(
		cadence.meanIntervalMs,
		`drag must run near frame-rate (mean rAF interval ${cadence.meanIntervalMs.toFixed(1)}ms; severe jank >> 60)`
	).toBeLessThan(70);
	expect(
		cadence.maxIntervalMs,
		`drag must not stall (worst rAF interval ${cadence.maxIntervalMs}ms)`
	).toBeLessThan(180);
});

// --- Bug 7 ------------------------------------------------------------------
// Settings back-button. The page slide (deepTrackTx) and the header bar-switch
// (rootLayerTy, the tab-bar descent) must run CONCURRENTLY, driven by one
// progress, not as two sequential phases ("slide fully completes, then the bar
// switches"). The discriminator: the bar-switch must START before the slide
// ENDS (overlap). The regression separates them by a visible gap. The header
// animation must also not jank.
test('Bug 7: settings back-button plays the page slide and the header bar-switch concurrently (not sequential) and does not jank', async ({
	page
}) => {
	await enterSettings(page);

	await installMultiSignalSampler(page, 1800);
	// Click the header back button (the user's exact action) and capture across
	// the whole transition. Do NOT await the URL first; the animation is the
	// subject.
	await page.locator('header button').first().click();
	await waitForMultiSignalDone(page);
	const frames = await readMultiSignalFrames(page);

	// Both the slide and the bar-switch must animate.
	const slide = signalRange(frames, (f) => f.deepTrackTx);
	const bar = signalRange(frames, (f) => f.rootLayerTy);
	console.log('Bug7 slide/bar ranges:', { slide, bar });
	expect(slide.range, 'the page slide must animate on back').toBeGreaterThan(40);
	expect(bar.range, 'the header tab-bar layer must descend on back').toBeGreaterThan(10);

	// Header bar-switch JANK (checked before the sequencing assertion so a janky
	// settle reproduces independently of the two-phase ordering). The bar-switch
	// must run near frame-rate with no stalls.
	const barAnim = analyzeAnimation(frames.map((f) => ({ t: f.t, value: f.rootLayerTy })));
	console.log('Bug7 bar-switch cadence:', barAnim);
	expect(
		barAnim.movingFrameCount,
		`header bar-switch must animate across multiple frames (got ${barAnim.movingFrameCount})`
	).toBeGreaterThanOrEqual(4);
	expect(
		barAnim.meanIntervalMs,
		`header bar-switch must run near frame-rate (mean ${barAnim.meanIntervalMs.toFixed(1)}ms; "very poor performance" >> 70)`
	).toBeLessThan(70);
	expect(
		barAnim.maxIntervalMs,
		`header bar-switch must not stall (worst ${barAnim.maxIntervalMs}ms)`
	).toBeLessThan(180);
	expect(
		barAnim.deceleration,
		'header bar-switch must decelerate (ease-out settle), not run linear / accelerating'
	).toBeGreaterThan(0);

	// Temporal overlap: find the active windows of each signal (frames where it
	// is moving > epsilon from its previous frame) and assert the bar-switch
	// STARTS before the slide ENDS. The regression plays them sequentially, so
	// the first bar-moving frame lands after the last slide-moving frame.
	const EPS = 2;
	const movingWindows = (
		pick: (f: MultiSignalFrame) => number | null
	): { startT: number; endT: number } | null => {
		let startT: number | null = null;
		let endT: number | null = null;
		let prev: number | null = null;
		for (const f of frames) {
			const v = pick(f);
			if (v === null) {
				prev = null;
				continue;
			}
			if (prev !== null && Math.abs(v - prev) > EPS) {
				if (startT === null) startT = f.t;
				endT = f.t;
			}
			prev = v;
		}
		return startT !== null && endT !== null ? { startT, endT } : null;
	};
	const slideWin = movingWindows((f) => f.deepTrackTx);
	const barWin = movingWindows((f) => f.rootLayerTy);
	console.log('Bug7 active windows:', { slideWin, barWin });

	expect(slideWin, 'must capture the slide active window').toBeTruthy();
	expect(barWin, 'must capture the bar-switch active window').toBeTruthy();
	const gap = (barWin!.startT ?? Infinity) - (slideWin!.endT ?? -Infinity);
	console.log(`Bug7 bar-start minus slide-end = ${gap}ms (negative = overlap)`);
	// The bar-switch must overlap (or tightly hand off to) the slide: it must
	// START within a couple frames of the slide ENDING, not after a visible gap.
	// The two-phase regression separates them by a clear gap (observed ~100ms).
	expect(
		gap,
		'bar-switch must overlap the slide (concurrent). A gap > ~2 frames is the two-phase regression.'
	).toBeLessThan(34);

	// The nav must actually land off the settings page.
	await page.waitForFunction(
		() => location.pathname !== '/profile/settings',
		{ timeout: 5000 }
	);
});
