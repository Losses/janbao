import { test, expect } from '@playwright/test';
import {
	prepareContext,
	waitForHydration,
	swipeBack,
	collectConsole,
	installMultiSignalSampler,
	waitForMultiSignalDone,
	readMultiSignalFrames,
	openSidebarAndGoto,
	type MultiSignalFrame
} from './helpers';

/**
 * DV20 Cycle 5b1 - pilot-route back-swipe gesture regression.
 *
 * Drives a real CDP touch gesture on the pilot route
 * `/messages/<numeric>` through the new pipeline
 * (`navPipelinePointer` -> orchestrator -> executor -> driver ->
 * `goto`) and asserts the slide plays EXACTLY ONCE: a single
 * monotonic translateX trajectory from the resting `-W` (centre
 * visible) toward `0` (left panel visible), with no replay, jump, or
 * back-track.
 *
 * The monotonic-trajectory assertion catches the double-slide
 * signature: a transition that plays, resets to the start, and
 * replays produces a sample array with at least one direction
 * reversal (e.g. `-W` -> `0` -> `-W` -> `0`); a clean single-slide
 * has zero reversals.
 */

interface TrackFrame {
	t: number;
	m41: number;
	/** FAB scale sampled from `[data-testid="fab"]`'s computed
	 * `transform`. Null when the FAB atom is not in the DOM (e.g.
	 * the route has unmounted). */
	fabScale: number | null;
}

interface TrackSamplerWindow extends Window {
	__pilotSwipe?: { frames: TrackFrame[]; done: boolean };
}

interface TrackSamplerCapture {
	frames: TrackFrame[];
	/** Monotonicity check: number of direction reversals. A single
	 * slide has zero reversals (the translateX moves in one direction
	 * the whole time). A double-slide has at least one reversal. */
	reversals: number;
	/** The first non-zero m41 sample (the start of the slide). */
	firstM41: number | null;
	/** The last m41 sample (the end of the slide). */
	lastM41: number | null;
	/** Min m41 across all samples. */
	minM41: number;
	/** Max m41 across all samples. */
	maxM41: number;
	/** FAB scale range across the in-flight samples. A transitioning
	 * FAB produces a non-zero range; a frozen publication produces
	 * zero. */
	fabScaleDelta: number;
	/** Direction reversals in the FAB scale trajectory. A continuous
	 *  ramp (no backward jumps) has zero reversals. A publication.progress
	 *  discontinuity at the drag-to-commit boundary produces at least
	 *  one reversal. */
	fabReversals: number;
	/** Sample count. */
	sampleCount: number;
}

/**
 * Install a rAF sampler that records the track's translateX (m41)
 * across the gesture. The sampler polls `.detail-scroll-pane`'s
 * parent (the multi-panel track) each frame for ~1.5s.
 */
async function capturePilotBackSwipe(
	page: import('@playwright/test').Page,
	trigger: () => Promise<void>
): Promise<TrackSamplerCapture> {
	await page.evaluate(() => {
		const w = window as unknown as TrackSamplerWindow;
		w.__pilotSwipe = { frames: [], done: false };
		const start = performance.now();
		const tick = (): void => {
			// Always check the timeout first so the sampler terminates
			// even if `.detail-scroll-pane` is gone (the route changed
			// mid-gesture, the pilot host unmounted).
			if (performance.now() - start > 1500) {
				w.__pilotSwipe!.done = true;
				return;
			}
			const centre = document.querySelector('.detail-scroll-pane');
			if (centre) {
				const track = centre.parentElement as HTMLElement | null;
				if (track) {
					let m41 = 0;
					try {
						m41 = new DOMMatrix(getComputedStyle(track).transform).m41;
					} catch {
						m41 = 0;
					}
					// Sample the FAB atom's scale. The FAB layer reads
					// the orchestrator's `publication.progress`
					// reactively (via `computeFabScale`, whose default
					// natural branch is `fabScale(progress, fromHasFab,
					// toHasFab)`) and writes the atom's `transform:
					// scale(...)`. The e2e asserts the scale transitions
					// during the commit slide so the FAB tracks the
					// slide (rather than freezing at a stale value).
					const fabEl = document.querySelector('[data-testid="fab"]');
					let fabScale: number | null = null;
					if (fabEl) {
						const m = getComputedStyle(fabEl).transform.match(/matrix\(([^)]+)\)/);
						fabScale = m ? Number(m[1].split(',')[0]) : 1;
					}
					w.__pilotSwipe!.frames.push({
						t: Math.round(performance.now() - start),
						m41: Math.round(m41),
						fabScale
					});
				}
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	await trigger();
	await page.waitForFunction(
		() => (window as unknown as TrackSamplerWindow).__pilotSwipe?.done === true,
		{ timeout: 5000 }
	);
	return page.evaluate(() => {
		const f = (window as unknown as TrackSamplerWindow).__pilotSwipe!.frames;
		const m41s = f.map((x) => x.m41);
		let reversals = 0;
		for (let i = 2; i < m41s.length; i++) {
			const a = m41s[i - 2];
			const b = m41s[i - 1];
			const c = m41s[i];
			// Count a reversal when the direction sign flips between
			// (a->b) and (b->c). Skip samples where consecutive values
			// are equal (idle frames).
			const d1 = b - a;
			const d2 = c - b;
			if (d1 !== 0 && d2 !== 0 && Math.sign(d1) !== Math.sign(d2)) {
				reversals++;
			}
		}
		// Find the first sample that diverges from the resting m41 (the
		// start of the slide). The resting m41 is the first sample's
		// value (the track is at rest before the gesture reaches the
		// commit phase).
		const rest = m41s[0] ?? 0;
		let firstMovingIdx = 0;
		for (let i = 1; i < m41s.length; i++) {
			if (Math.abs(m41s[i] - rest) > 5) {
				firstMovingIdx = i;
				break;
			}
		}
		const movingM41s = m41s.slice(firstMovingIdx);
		// FAB scale range across the in-flight samples (the moving
		// window). Null samples (FAB atom gone) are excluded.
		const fabScales = f.slice(firstMovingIdx)
			.map((x) => x.fabScale)
			.filter((v): v is number => v !== null);
		const fabScaleDelta =
			fabScales.length > 0 ? Math.max(...fabScales) - Math.min(...fabScales) : 0;
		// FAB scale reversals: count direction flips (same algorithm as
		// the track m41 reversals, applied to the FAB scale samples).
		let fabReversals = 0;
		for (let i = 2; i < fabScales.length; i++) {
			const d1 = fabScales[i - 1] - fabScales[i - 2];
			const d2 = fabScales[i] - fabScales[i - 1];
			if (Math.abs(d1) > 0.01 && Math.abs(d2) > 0.01 && Math.sign(d1) !== Math.sign(d2)) {
				fabReversals++;
			}
		}
		return {
			frames: f,
			reversals,
			firstM41: movingM41s[0] ?? null,
			lastM41: m41s[m41s.length - 1] ?? null,
			minM41: m41s.length ? Math.min(...m41s) : 0,
			maxM41: m41s.length ? Math.max(...m41s) : 0,
			fabScaleDelta,
			fabReversals,
			sampleCount: f.length
		};
	});
}

test.describe('DV20 5b1 pilot back-swipe gesture', () => {
	test.beforeEach(async ({ context }) => {
		await prepareContext(context);
	});

	test('back-swipe from /messages/<id> plays a single monotonic slide', async ({ page }) => {
		const consoleMessages = collectConsole(page);
		// Enter the pilot conversation route: visit the inbox,
		// hydrate, then click the first conversation.
		await page.goto('/');
		await waitForHydration(page);
		await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(200);
		await page
			.locator('a[href^="/messages/"]:not([href="/messages/inbox"]):not([href="/messages/new"])')
			.first()
			.click();
		await page.waitForURL(/\/messages\/\d+/);
		await page.waitForSelector('.detail-scroll-pane');
		// Let the enter settle before triggering the gesture.
		await page.waitForTimeout(500);

		const capture: TrackSamplerCapture = await capturePilotBackSwipe(page, async () => {
			await swipeBack(page);
		});

		console.log('[pilot-back-swipe] capture:', {
			reversals: capture.reversals,
			firstM41: capture.firstM41,
			lastM41: capture.lastM41,
			minM41: capture.minM41,
			maxM41: capture.maxM41,
			fabScaleDelta: capture.fabScaleDelta,
			fabReversals: capture.fabReversals,
			sampleCount: capture.sampleCount,
			consoleTail: consoleMessages.slice(-5)
		});

		// The slide must actually run. A rightward back-swipe on the
		// pilot's multi-panel track slides the track from `-W` (centre
		// visible) toward `0` (left panel visible). On Pixel 5 (W=393)
		// this is at least a 200px delta.
		const delta = capture.maxM41 - capture.minM41;
		expect(
			delta,
			`back-swipe must produce a slide (delta=${delta}, samples=${capture.sampleCount})`
		).toBeGreaterThan(200);

		// A clean single-slide has zero direction reversals. A
		// transition that plays twice (e.g. from a settle-dispatch
		// race where the orchestrator cancels its own goto's nav and
		// starts a second slide plan) produces at least one reversal.
		expect(
			capture.reversals,
			`back-swipe must play exactly once (reversals=${capture.reversals}; ` +
				`first=${capture.firstM41}, last=${capture.lastM41}, ` +
				`min=${capture.minM41}, max=${capture.maxM41})`
		).toBe(0);

		// The slide direction must be rightward: m41 goes from `-W`
		// (more negative) toward `0` (less negative). So `lastM41`
		// (the end of the gesture) should be > `firstM41` (the start).
		expect(
			capture.lastM41 ?? -Infinity,
			`back-swipe must move the track rightward (first=${capture.firstM41}, last=${capture.lastM41})`
		).toBeGreaterThan(capture.firstM41 ?? -Infinity);

		// The FAB scale must transition during the slide. The pilot's
		// back-swipe goes from `/messages/<id>` (FAB hidden, scale 0)
		// to `/messages/inbox` (FAB shown, scale 1); the orchestrator
		// publishes `publication.progress` each commit rAF tick so the FAB
		// atom's scale ramps with the slide. A frozen publication
		// (orchestrator not republishing during commit) leaves the
		// scale stuck at its initial value (delta 0). The threshold
		// is small (0.1) to allow for the FAB atom's own CSS easing
		// while still catching a fully frozen publication.
		expect(
			capture.fabScaleDelta,
			`FAB scale must transition during the slide (delta=${capture.fabScaleDelta}; ` +
				`the orchestrator must republish to the pager store each commit rAF tick)`
		).toBeGreaterThan(0.1);

		// The FAB scale must ramp monotonically (no reversals). A
		// publication.progress discontinuity at the drag-to-commit boundary
		// (raw fraction vs threshold-absorbed progress) produces at
		// least one FAB-scale reversal.
		expect(
			capture.fabReversals,
			`FAB scale must ramp monotonically (reversals=${capture.fabReversals}; ` +
				`publication.progress must be continuous across the drag-to-commit boundary)`
		).toBe(0);

		// The commit must dispatch the nav (settle -> goto). A regression
		// where the slide plays but the dispatch never fires would pass the
		// trajectory assertions above but fail this.
		await page.waitForURL('**/messages/inbox', { timeout: 5000 });
		expect(page.url(), 'back-swipe commit must land on /messages/inbox').toMatch(
			/\/messages\/inbox/
		);
	});

	test('partial swipe (< 60px) cancels and stays on the pilot route', async ({ page }) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(200);
		await page
			.locator('a[href^="/messages/"]:not([href="/messages/inbox"]):not([href="/messages/new"])')
			.first()
			.click();
		await page.waitForURL(/\/messages\/\d+/);
		await page.waitForSelector('.detail-scroll-pane');
		await page.waitForTimeout(500);

		const pilotPath = page.url();
		const client = await page.context().newCDPSession(page);
		await client.send('Emulation.setTouchEmulationEnabled', {
			enabled: true,
			maxTouchPoints: 5
		});
		const y = 400;
		const startX = 120;
		const endX = 150;
		const dispatch = (
			type: 'touchStart' | 'touchMove' | 'touchEnd',
			x: number,
			state: string
		) =>
			client.send('Input.dispatchTouchEvent', {
				type,
				touchPoints: [{ state, x, y, id: 1 }] as unknown as never,
				modifiers: 0,
				timestamp: 0
			});
		await dispatch('touchStart', startX, 'touchPressed');
		for (let i = 1; i <= 10; i++) {
			const x = Math.round(startX + (endX - startX) * (i / 10));
			await dispatch('touchMove', x, 'touchMoved');
		}
		await dispatch('touchEnd', endX, 'touchReleased');
		await client.detach();
		await page.waitForTimeout(500);

		// The URL must NOT change (the gesture cancelled, no navigation).
		expect(page.url(), 'partial swipe must not navigate').toBe(pilotPath);
	});

	test('reversed swipe (right then back past start) cancels and stays on the pilot route', async ({
		page
	}) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(200);
		await page
			.locator('a[href^="/messages/"]:not([href="/messages/inbox"]):not([href="/messages/new"])')
			.first()
			.click();
		await page.waitForURL(/\/messages\/\d+/);
		await page.waitForSelector('.detail-scroll-pane');
		await page.waitForTimeout(500);

		const pilotPath = page.url();
		const client = await page.context().newCDPSession(page);
		await client.send('Emulation.setTouchEmulationEnabled', {
			enabled: true,
			maxTouchPoints: 5
		});
		const y = 400;
		const startX = 120;
		const peakX = 320;
		// Release past the start far enough that |offset| >= SWIPE_COMMIT
		// (endX - startX = -80), so the test exercises the SIGNED offset
		// gate (a release with abs(offset) >= 60 but offset < 0 must
		// cancel, not commit).
		const endX = 40;
		const dispatch = (
			type: 'touchStart' | 'touchMove' | 'touchEnd',
			x: number,
			state: string
		) =>
			client.send('Input.dispatchTouchEvent', {
				type,
				touchPoints: [{ state, x, y, id: 1 }] as unknown as never,
				modifiers: 0,
				timestamp: 0
			});
		await dispatch('touchStart', startX, 'touchPressed');
		// Drag right past SWIPE_COMMIT (200px).
		for (let x = startX + 20; x <= peakX; x += 20) {
			await dispatch('touchMove', x, 'touchMoved');
		}
		// Reverse past start (offsetX < 0).
		for (let x = peakX - 20; x >= endX; x -= 20) {
			await dispatch('touchMove', x, 'touchMoved');
		}
		await dispatch('touchEnd', endX, 'touchReleased');
		await client.detach();
		await page.waitForTimeout(500);

		// The URL must NOT change (the gesture reversed, no navigation).
		expect(page.url(), 'reversed swipe must not navigate').toBe(pilotPath);
	});

	test('rebound swipe (right 200px then partial rebound to +130px, slow release) cancels', async ({
		page
	}) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(200);
		await page
			.locator('a[href^="/messages/"]:not([href="/messages/inbox"]):not([href="/messages/new"])')
			.first()
			.click();
		await page.waitForURL(/\/messages\/\d+/);
		await page.waitForSelector('.detail-scroll-pane');
		await page.waitForTimeout(500);

		const pilotPath = page.url();
		const client = await page.context().newCDPSession(page);
		await client.send('Emulation.setTouchEmulationEnabled', {
			enabled: true,
			maxTouchPoints: 5
		});
		const y = 400;
		const startX = 120;
		const peakX = 320;
		const endX = 250;
		const dispatch = (
			type: 'touchStart' | 'touchMove' | 'touchEnd',
			x: number,
			state: string
		) =>
			client.send('Input.dispatchTouchEvent', {
				type,
				touchPoints: [{ state, x, y, id: 1 }] as unknown as never,
				modifiers: 0,
				timestamp: 0
			});
		await dispatch('touchStart', startX, 'touchPressed');
		// Drag right past SWIPE_COMMIT (200px).
		for (let x = startX + 20; x <= peakX; x += 20) {
			await dispatch('touchMove', x, 'touchMoved');
		}
		// Rebound partially (peak - final = 70px >= REBOUND_CANCEL_PX=25).
		// Release slowly so no forward fling overrides the rebound gate.
		for (let x = peakX - 10; x >= endX; x -= 10) {
			await dispatch('touchMove', x, 'touchMoved');
		}
		await dispatch('touchEnd', endX, 'touchReleased');
		await client.detach();
		await page.waitForTimeout(500);

		// The URL must NOT change. detectSwipe reports reversed=true
		// (rebound=70 >= 25, no forward fling), so the orchestrator's
		// gate cancels. The final offset (+130) is past SWIPE_COMMIT
		// but the rebound-based reversed signal catches it.
		expect(page.url(), 'rebound swipe must not navigate').toBe(pilotPath);
	});

	test('sub-threshold-morph commit (70px drag, commits, raw < morph threshold)', async ({
		page
	}) => {
		const consoleMessages = collectConsole(page);
		await page.goto('/');
		await waitForHydration(page);
		await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(200);
		await page
			.locator('a[href^="/messages/"]:not([href="/messages/inbox"]):not([href="/messages/new"])')
			.first()
			.click();
		await page.waitForURL(/\/messages\/\d+/);
		await page.waitForSelector('.detail-scroll-pane');
		await page.waitForTimeout(500);

		const capture: TrackSamplerCapture = await capturePilotBackSwipe(page, async () => {
			// 70px rightward drag: above SWIPE_COMMIT (60) so it
			// commits, but below the morph threshold (0.2 * 393 ≈ 78px)
			// so the threshold-absorbed progress is 0 at release.
			const client = await page.context().newCDPSession(page);
			await client.send('Emulation.setTouchEmulationEnabled', {
				enabled: true,
				maxTouchPoints: 5
			});
			const y = 400;
			const startX = 120;
			const endX = 190;
			const dispatch = (
				type: 'touchStart' | 'touchMove' | 'touchEnd',
				x: number,
				state: string
			) =>
				client.send('Input.dispatchTouchEvent', {
					type,
					touchPoints: [{ state, x, y, id: 1 }] as unknown as never,
					modifiers: 0,
					timestamp: 0
				});
			await dispatch('touchStart', startX, 'touchPressed');
			for (let i = 1; i <= 10; i++) {
				const x = Math.round(startX + (endX - startX) * (i / 10));
				await dispatch('touchMove', x, 'touchMoved');
			}
			await dispatch('touchEnd', endX, 'touchReleased');
			await client.detach();
		});

		console.log('[pilot-sub-threshold] capture:', {
			reversals: capture.reversals,
			fabReversals: capture.fabReversals,
			fabScaleDelta: capture.fabScaleDelta,
			sampleCount: capture.sampleCount,
			consoleTail: consoleMessages.slice(-5)
		});

		// Must commit (navigate to /messages/inbox).
		expect(page.url(), '70px swipe must commit').toMatch(/\/messages\/inbox/);

		// The FAB scale must not reverse at the drag-to-commit
		// boundary (#commitStartRaw lerps the publication from the
		// live-drag raw so publication.progress does not jump backward).
		expect(
			capture.fabReversals,
			`FAB scale must not reverse for sub-threshold commit (reversals=${capture.fabReversals})`
		).toBe(0);

		// The slide must actually run - a direct dispatch that changed the
		// URL without animating would leave delta ~0.
		const delta = capture.maxM41 - capture.minM41;
		expect(
			delta,
			`sub-threshold commit must produce a slide (delta=${delta}, samples=${capture.sampleCount})`
		).toBeGreaterThan(50);
		expect(
			capture.reversals,
			`sub-threshold commit must play a single slide (reversals=${capture.reversals})`
		).toBe(0);
	});

	test('forward enter from /messages/inbox slides the track into view', async ({ page, context }) => {
		await prepareContext(context);
		await page.goto('/messages/inbox');
		await waitForHydration(page);

		// Install a rAF sampler that captures the track's translateX from
		// the moment it appears (the enter animation runs on mount).
		await page.evaluate(() => {
			(window as any).__enterSamples = [] as number[];
			(window as any).__fabEnterSamples = [] as number[];
			const sample = () => {
				const track = document.querySelector('[data-testid="nav-pipeline-track"]');
				if (track) {
					const cs = getComputedStyle(track);
					const m = new DOMMatrix(cs.transform);
					(window as any).__enterSamples.push(m.m41);
				}
				const fab = document.querySelector('[data-testid="fab"]');
				if (fab) {
					try {
						(window as any).__fabEnterSamples.push(
							new DOMMatrix(getComputedStyle(fab).transform).a
						);
					} catch {
						/* transform not parseable yet */
					}
				}
				requestAnimationFrame(sample);
			};
			requestAnimationFrame(sample);
		});

		// Click the first conversation link (forward SPA nav).
		await page.click('a[href^="/messages/"]:not([href="/messages/new"]):not([href="/messages/inbox"])');
		await page.waitForURL(/\/messages\/\d+/);
		await page.waitForTimeout(300);

		// Read the captured samples.
		const samples = (await page.evaluate(() => (window as any).__enterSamples)) as number[];

		// The enter animation should have captured multiple frames with
		// movement (from ~0px at animation start to ~-W px at rest).
		expect(samples.length, 'sampler should have captured frames').toBeGreaterThan(3);
		const first = samples[0];
		const last = samples[samples.length - 1];
		expect(Math.abs(last - first), `track should have slid during enter (first=${first}, last=${last})`).toBeGreaterThan(50);
		// Forward enter slides the track LEFTWARD (0 -> -W): the rest
		// sample is more negative than the enter-start sample.
		expect(
			last - first,
			`forward enter must slide leftward, not rightward (first=${first}, last=${last})`
		).toBeLessThan(-50);

		// The forward-enter's target is the conversation (overlay family, no
		// resting FAB). The FAB scales 1->0 across the enter via
		// `computeFabScale`'s default natural branch
		// `fabScale(progress, fromHasFab=true, toHasFab=false)`
		// (max(0, 1 - progress*2): reaches 0 at progress 0.5 and holds at 0 through
		// landing), so the FAB never spikes back up. Sample the FAB scale across the
		// enter and assert
		// no flicker: once the scale first drops below 0.1 it stays below 0.5.
		const fabSamples = (await page.evaluate(() => (window as any).__fabEnterSamples)) as number[];
		if (fabSamples.length > 4) {
			const droppedIdx = fabSamples.findIndex((s) => s < 0.1);
			if (droppedIdx >= 0) {
				const maxAfter = Math.max(...fabSamples.slice(droppedIdx));
				expect(
					maxAfter,
					`forward-enter FAB must not flicker back up after easing out (fabSamples=${fabSamples.map((s) => s.toFixed(2)).join(',')})`
				).toBeLessThan(0.5);
			}
		}
	});

	test('back-swipe started during forward-enter interrupts cleanly and commits', async ({ page, context }) => {
		await prepareContext(context);
		await page.goto('/messages/inbox');
		await waitForHydration(page);

		// Install a rAF sampler to capture the track trajectory across
		// the forward-enter -> back-swipe interrupt boundary.
		await page.evaluate(() => {
			(window as any).__gestureEnterSamples = [] as number[];
			const sample = () => {
				const track = document.querySelector('[data-testid="nav-pipeline-track"]');
				if (track) {
					const m = new DOMMatrix(getComputedStyle(track).transform);
					(window as any).__gestureEnterSamples.push(m.m41);
				}
				requestAnimationFrame(sample);
			};
			requestAnimationFrame(sample);
		});

		// Click a conversation link to trigger the forward-enter.
		await page.click('a[href^="/messages/"]:not([href="/messages/new"]):not([href="/messages/inbox"])');
		await page.waitForURL(/\/messages\/\d+/);
		// Do NOT wait out the enter animation; start the swipe immediately.
		await swipeBack(page);
		await page.waitForURL('**/messages/inbox', { timeout: 5000 });

		// Assert no backward jump (reversals = 0 across the interrupt).
		const samples = (await page.evaluate(() => (window as any).__gestureEnterSamples)) as number[];
		expect(samples.length, 'sampler should have captured frames').toBeGreaterThan(3);
		let reversals = 0;
		for (let i = 2; i < samples.length; i++) {
			const prevDelta = samples[i - 1] - samples[i - 2];
			const currDelta = samples[i] - samples[i - 1];
			if (prevDelta * currDelta < 0) reversals++;
		}
		expect(
			reversals,
			`track should not reverse during gesture-during-enter interrupt (samples=${samples.slice(0, 10).join(',')})`
		).toBe(0);
	});

	test('tab-click during forward-enter interrupts cleanly and navigates', async ({ page, context }) => {
		await prepareContext(context);
		await page.goto('/messages/inbox');
		await waitForHydration(page);

		// Sample the track translateX across the forward-enter -> tab-click
		// interrupt so a visual teleport (a broken handoff) is caught, not
		// just the landing URL.
		await page.evaluate(() => {
			(window as any).__tabEnterSamples = [] as number[];
			const sample = () => {
				const track = document.querySelector('[data-testid="nav-pipeline-track"]');
				if (track) {
					(window as any).__tabEnterSamples.push(
						new DOMMatrix(getComputedStyle(track).transform).m41
					);
				}
				requestAnimationFrame(sample);
			};
			requestAnimationFrame(sample);
		});

		// Click a conversation link to trigger the forward-enter.
		await page.click('a[href^="/messages/"]:not([href="/messages/new"]):not([href="/messages/inbox"])');
		await page.waitForURL(/\/messages\/\d+/);
		// Do NOT wait out the enter animation; click a tab immediately.
		// The enter animation is ~300ms; the tab-click must begin within
		// that window to exercise the onSvelteKitBeforeNavigate interrupt
		// path.
		await page.click('[data-tab-nav][href="/messages/inbox"]');

		// The tab-click should commit: URL returns to /messages/inbox.
		await page.waitForURL('**/messages/inbox', { timeout: 5000 });

		const samples = (await page.evaluate(() => (window as any).__tabEnterSamples)) as number[];
		expect(samples.length, 'sampler should have captured track frames').toBeGreaterThan(3);
		// The interrupt handoff (#startProgressFromCurrentVisual) starts the
		// tab-click from the enter's current visual, so no frame teleports
		// the track. A normal slide frame is ~30-40px; a broken handoff
		// jumps ~W. Bound the max single-frame delta well below W.
		let maxDelta = 0;
		for (let i = 1; i < samples.length; i++) {
			maxDelta = Math.max(maxDelta, Math.abs(samples[i] - samples[i - 1]));
		}
		expect(
			maxDelta,
			`tab-click-during-enter must not teleport the track (maxDelta=${maxDelta})`
		).toBeLessThan(150);
	});

	test('tab-click during gesture commit finishes the commit (accelerated) before navigating', async ({
		page,
		context
	}) => {
		await prepareContext(context);
		await page.goto('/messages/inbox');
		await waitForHydration(page);

		// Click a conversation to land on the pilot.
		await page.click('a[href^="/messages/"]:not([href="/messages/new"]):not([href="/messages/inbox"])');
		await page.waitForURL(/\/messages\/\d+/);
		await page.waitForTimeout(500);

		// Install a rAF sampler to capture the track trajectory across
		// the gesture commit -> tab-click interrupt boundary.
		await page.evaluate(() => {
			(window as any).__commitInterruptSamples = [] as number[];
			const sample = () => {
				const track = document.querySelector('[data-testid="nav-pipeline-track"]');
				if (track) {
					const m = new DOMMatrix(getComputedStyle(track).transform);
					(window as any).__commitInterruptSamples.push(m.m41);
				}
				requestAnimationFrame(sample);
			};
			requestAnimationFrame(sample);
		});

		// Start a back-swipe and release past SWIPE_COMMIT to enter the
		// commit phase, then immediately click a tab during the commit
		// rAF window (~200ms). The finish-then-new interruption policy
		// accelerates the in-flight commit to completion, then replays
		// the tab-click on the landed host. Both the commit and the
		// tab-click target /messages/inbox here, so the replay is a
		// no-op (already at the target); the assertion verifies the
		// commit itself completed.
		await swipeBack(page);
		await page.click('[data-tab-nav][href="/messages/inbox"]');
		await page.waitForURL('**/messages/inbox', { timeout: 5000 });

		// The commit completed (accelerated) before the host swap: the
		// track reached near the back-target visual (translateX close to
		// 0 for a thread-host backward commit). After the swap the
		// sampler may read the tab host's track at a different resting
		// position, so the peak (max translateX) is the meaningful
		// pre-swap signal.
		const samples = (await page.evaluate(() => (window as any).__commitInterruptSamples)) as number[];
		expect(samples.length, 'sampler should have captured frames').toBeGreaterThan(3);
		const maxTx = Math.max(...samples);
		expect(
			maxTx,
			`commit should reach near the back-target visual before landing (samples=${samples.slice(0, 10).join(',')})`
		).toBeGreaterThan(-80);
	});

	test('tab-click to a different tab during gesture commit finishes the commit then navigates to the new tab', async ({
		page,
		context
	}) => {
		await prepareContext(context);
		await page.goto('/messages/inbox');
		await waitForHydration(page);

		// Click a conversation to land on the pilot.
		await page.click('a[href^="/messages/"]:not([href="/messages/new"]):not([href="/messages/inbox"])');
		await page.waitForURL(/\/messages\/\d+/);
		await page.waitForTimeout(500);

		// Start a back-swipe toward /messages/inbox, then click the
		// Discussions tab (/) during the commit window. The
		// finish-then-new policy accelerates the commit to /messages/inbox
		// first, then replays the tab-click to / on the tab host.
		await swipeBack(page);
		await page.click('[data-tab-nav][href="/"]');
		// The commit lands on /messages/inbox, then the queued tab-click
		// navigates to /.
		await page.waitForURL('/', { timeout: 5000 });
	});

	// Preventive cover for the finish-then-new queue-replay replaceState
	// invariant. The orchestrator's `#dispatchNav` reads `replaceState`
	// from the pager store side-channel, so a replace-intent nav queued
	// during an in-flight commit (the `Header.onBack` scenario) must
	// preserve the intent across two dispatch sites:
	//   1. The COMMIT's dispatch must NOT read the queued nav's intent
	//      (the commit's target is the wrong URL for the replace).
	//   2. The REPLAY's dispatch MUST read the queued nav's intent (the
	//      intent's correct target is the queued nav's).
	// The capture-clear-rearm flow enforces both: the finish-then-new
	// branch captures the store into `#queuedDiscreteNav.replaceState`
	// and clears the store; `#landAtRest` re-arms the store from the
	// queue before firing the replay goto.
	//
	// This test drives the scenario via the dev-only `__e2eGoto` hook:
	// during a back-swipe's commit slide we set the pager store to
	// `replaceStateIntent = true` and fire `goto('/activity', {
	// replaceState: true })`. The orchestrator's finish-then-new policy
	// queues the goto, accelerates the commit to /messages/inbox
	// (history.back), then replays the queued /activity nav. The replay
	// honours the captured intent (replaceState: true), so the
	// /messages/inbox entry (the one the commit's history.back moved the
	// pointer to) is REPLACED by /activity: the entry immediately behind
	// the new /activity current is '/'. A push instead of a replace
	// appends /activity after /messages/inbox (pruning the prior forward
	// /messages/<id> entry), so the entry behind /activity stays
	// /messages/inbox. The discriminator is `navigation.entries()` read
	// directly: the entry at `currentEntry.index - 1` is '/' when the
	// replace is preserved, or '/messages/inbox' when the replay
	// degrades to a push.
	test('replaceState intent survives a queue-replay (replace-intent nav queued during a commit)', async ({
		page,
		context
	}) => {
		await prepareContext(context);
		// Land on /messages/inbox first so the conversation push creates a
		// well-shaped stack: ['/', '/messages/inbox', '/messages/<id>'].
		await page.goto('/');
		await waitForHydration(page);
		await page.click('a[data-tab-nav][href="/messages/inbox"]');
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(200);
		await page.click('a[href^="/messages/"]:not([href="/messages/new"]):not([href="/messages/inbox"])');
		await page.waitForURL(/\/messages\/\d+/);
		await page.waitForTimeout(500);

		// Drive a back-swipe; the commit slide is in flight for ~200ms after
		// the touch release, which is the window in which a `Header.onBack`
		// (or any programmatic replace-intent goto) lands and gets queued.
		await swipeBack(page);
		// Immediately fire the replace-intent nav: set the side-channel the
		// same way `Header.onBack` does, then goto via the dev hook (the
		// production caller uses `$app/navigation`'s `goto`). The orchestrator
		// intercepts this in `onSvelteKitBeforeNavigate`, sees the executor is
		// still in `phase === 'committing'`, captures the intent into
		// `#queuedDiscreteNav`, and cancels the goto. `navigation.cancel()`
		// discards the goto's own `replaceState` option, so the store is the
		// ONLY path the intent can survive through.
		await page.evaluate(async () => {
			const w = window as unknown as {
				__primaryPager?: { setReplaceStateIntent: (v: boolean) => void };
				__e2eGoto?: (href: string, opts?: { replaceState?: boolean }) => Promise<void>;
			};
			w.__primaryPager!.setReplaceStateIntent(true);
			await w.__e2eGoto!('/activity', { replaceState: true });
		});

		// The commit lands on /messages/inbox, then the queued replay fires
		// and the orchestrator drives a fresh slide plan for /activity. Wait
		// for the replay to land.
		await page.waitForURL('**/activity', { timeout: 5000 });
		// Hold for the post-landing settle: afterNavigate fires #landAtRest,
		// the orchestrator clears the queue + replaceState side-channel, and
		// SvelteKit's history write commits. The stack is what we assert, so
		// we wait for it to stabilise before reading navigation.entries().
		await page.waitForTimeout(200);

		// Assert the ENTRY BEHIND the current /activity via the Navigation
		// API. When the replace intent is preserved, /activity REPLACES
		// /messages/inbox (the entry the commit's history.back moved the
		// pointer to), so the previous entry is '/'. When the replay
		// degrades to a push, /activity is appended after /messages/inbox
		// (and the prior forward /messages/<id> entry is pruned by the
		// push), so the previous entry is '/messages/inbox'.
		//
		// This is the same discrimination the user-visible
		// `history.back()` landing gives ('/' for a replace vs
		// '/messages/inbox' for a push), read directly from the session
		// history without driving another navigation. Reading
		// `navigation.entries()` is deterministic because both '/' and
		// '/activity' are pipeline routes: an actual `history.back()`
		// would re-enter the orchestrator's `onSvelteKitBeforeNavigate`,
		// which calls `navigation.cancel()` (discrete-nav branch) and
		// runs a fresh slide plan. During that intercept cycle the URL
		// transiently flips `/activity` -> '/' (popstate) -> '/activity'
		// (cancel revert) -> '/' (the slide's eventual #dispatchNav
		// history.back, ~300ms later). A `waitForFunction` poll can
		// resolve on the FIRST transient '/' while Playwright's tracked
		// `page.url()` still reads the reverted '/activity', desyncing
		// the assertion. `navigation.entries()` reads the session history
		// synchronously with no navigation triggered, so the
		// orchestrator's intercept cycle never runs and there is no URL
		// transient to race.
		const historyAround = await page.evaluate(() => {
			if (typeof navigation === 'undefined' || !navigation.currentEntry) {
				throw new Error('Navigation API unavailable in this browser');
			}
			const entries = navigation.entries();
			const currentIdx = navigation.currentEntry.index;
			const prev = currentIdx > 0 ? entries[currentIdx - 1] : null;
			return {
				current: new URL(navigation.currentEntry.url).pathname,
				prev: prev ? new URL(prev.url).pathname : null
			};
		});
		expect(
			historyAround.current,
			`post-replay current entry must be '/activity'`
		).toBe('/activity');
		expect(
			historyAround.prev,
			`entry behind '/activity' must be '/' (replace preserved the intent); ` +
				`'/messages/inbox' means the replay degraded the replace to a push`
		).toBe('/');
	});

	// The gesture-during-tab-click-commit interrupt is not separately
	// e2e'd here: the gesture must catch the tab-click's ~300ms slide,
	// a race too tight to be reliable under varying dev-server
	// load. The fix (#beginGesture clears #pendingTabExit so a gesture's
	// settle dispatches its own target) is code-verified, and the
	// gesture-during-commit interrupt IS covered by the "re-grab
	// mid-commit" test below (same #beginGesture path, a wider window).

	test('re-grab mid-commit continues from the current position (no backward jump, §5)', async ({
		page,
		context
	}) => {
		await prepareContext(context);
		await page.goto('/messages/inbox');
		await waitForHydration(page);
		await page.click('a[href^="/messages/"]:not([href="/messages/new"]):not([href="/messages/inbox"])');
		await page.waitForURL(/\/messages\/\d+/);
		await page.waitForTimeout(500);

		await page.evaluate(() => {
			(window as any).__regrab = [] as number[];
			const sample = (): void => {
				const track = document.querySelector('[data-testid="nav-pipeline-track"]');
				if (track) {
					(window as any).__regrab.push(new DOMMatrix(getComputedStyle(track).transform).m41);
				}
				requestAnimationFrame(sample);
			};
			requestAnimationFrame(sample);
		});

		// First swipe releases past SWIPE_COMMIT -> commit starts. The
		// second swipe re-grabs mid-commit; the new gesture must continue
		// from the commit's current visual position (no backward jump).
		await swipeBack(page);
		await swipeBack(page);
		await page.waitForURL('**/messages/inbox', { timeout: 5000 });

		const samples = (await page.evaluate(() => (window as any).__regrab)) as number[];
		expect(samples.length, 'sampler should have captured frames').toBeGreaterThan(3);
		let reversals = 0;
		for (let i = 2; i < samples.length; i++) {
			const prevDelta = samples[i - 1] - samples[i - 2];
			const currDelta = samples[i] - samples[i - 1];
			if (prevDelta * currDelta < 0) reversals++;
		}
		expect(
			reversals,
			`re-grab should not reverse the track (samples=${samples.slice(0, 10).join(',')})`
		).toBe(0);
	});

	test('leftward drag during a commit does not strand the track or drop the nav', async ({
		page,
		context
	}) => {
		await prepareContext(context);
		await page.goto('/messages/inbox');
		await waitForHydration(page);
		await page.click('a[href^="/messages/"]:not([href="/messages/new"]):not([href="/messages/inbox"])');
		await page.waitForURL(/\/messages\/\d+/);
		await page.waitForTimeout(500);

		// Pre-arm one CDP touch session for both halves (no Playwright async
		// gap between the release and the leftward drag, so the leftward
		// drag lands inside the commit's ~200ms window deterministically).
		const client = await page.context().newCDPSession(page);
		await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
		const width = page.viewportSize()?.width ?? 393;
		const touch = (
			type: 'touchStart' | 'touchMove' | 'touchEnd',
			x: number,
			state: string
		) =>
			client.send('Input.dispatchTouchEvent', {
				type,
				touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
				modifiers: 0,
				timestamp: 0
			});
		// Rightward back-swipe past SWIPE_COMMIT -> commit starts.
		const rightStart = Math.round(width * 0.3);
		await touch('touchStart', rightStart, 'touchPressed');
		for (let i = 1; i <= 10; i++) {
			await touch('touchMove', rightStart + Math.round((240 * i) / 10), 'touchMoved');
		}
		await touch('touchEnd', rightStart + 240, 'touchReleased');
		// Immediately a leftward drag during the commit (thumb jitter or a
		// change of mind). The pilot does not claim leftward, so the commit
		// must continue and dispatch /messages/inbox (not strand the track
		// with the inbox showing but the URL still on the conversation).
		const leftStart = Math.round(width * 0.7);
		await touch('touchStart', leftStart, 'touchPressed');
		for (let i = 1; i <= 8; i++) {
			await touch('touchMove', leftStart - Math.round((200 * i) / 8), 'touchMoved');
		}
		await touch('touchEnd', leftStart - 200, 'touchReleased');
		await client.detach();
		await page.waitForURL('**/messages/inbox', { timeout: 5000 });
		expect(page.url(), 'leftward drag during commit must not drop the nav').toMatch(
			/\/messages\/inbox/
		);
	});

	test('back-swipe preview restores the inbox scroll position (R62 MED)', async ({
		page,
		context
	}) => {
		await prepareContext(context);
		await page.goto('/messages/inbox');
		await waitForHydration(page);

		// Shrink the viewport so the inbox list overflows it. The seed's
		// inbox is short at the default Pixel 5 height; a small viewport
		// makes the existing content scrollable. (The inbox + left-panel
		// data is SSR-embedded via SvelteKit server load, not a client
		// fetch, so a route() interception is unreliable here.)
		await page.setViewportSize({ width: 393, height: 240 });

		const inboxPane = page.locator('[data-tab-panel="messages"]');
		await inboxPane.waitFor();
		await inboxPane.evaluate((el: HTMLElement) => {
			el.scrollTop = 150;
			el.dispatchEvent(new Event('scroll', { bubbles: true }));
		});
		await page.waitForTimeout(100);
		const scrolled = await inboxPane.evaluate((el: HTMLElement) => el.scrollTop);
		expect(scrolled, 'inbox must be scrollable (viewport shrunk)').toBeGreaterThan(0);

		// Navigate to a conversation; NavPipelineHost mounts and the left
		// panel (the inbox preview) must restore the cached scroll position
		// (matching GPL). A regression renders the preview at scrollTop 0.
		await page.click(
			'a[href^="/messages/"]:not([href="/messages/new"]):not([href="/messages/inbox"])'
		);
		await page.waitForURL(/\/messages\/\d+/);
		await waitForHydration(page);

		const leftScrollTop = await page.evaluate(() => {
			const track = document.querySelector('[data-testid="nav-pipeline-track"]');
			const left = track?.querySelector('[data-tab-panel="messages"]');
			return left ? (left as HTMLElement).scrollTop : -1;
		});
		expect(
			leftScrollTop,
			`left panel must restore the cached inbox scroll (got ${leftScrollTop})`
		).toBeGreaterThan(0);
	});

	test('a tab-click to the discussions tab scales the FAB in with the slide (refactor)', async ({
		page,
		context
	}) => {
		await prepareContext(context);
		await page.goto('/messages/inbox');
		await waitForHydration(page);
		// Open a conversation (the pilot route).
		await page.click(
			'a[href^="/messages/"]:not([href="/messages/new"]):not([href="/messages/inbox"])'
		);
		await page.waitForURL(/\/messages\/\d+/);
		await waitForHydration(page);

		// Sample the FAB atom's scale and the layer's kind across the
		// tab-click slide. The refactor drives the FAB from the slide
		// progress for a FAB-bearing target, so it must scale in (not stay
		// frozen at 0) and resolve the destination's kind.
		await page.evaluate(() => {
			const w = window as unknown as {
				__fabTabSamples?: Array<{ scale: number; kind: string | null }>;
			};
			w.__fabTabSamples = [];
			const sample = (): void => {
				const atom = document.querySelector('[data-testid="fab"]');
				const layer = document.querySelector('[data-fab-kind]');
				const m = atom ? getComputedStyle(atom).transform.match(/matrix\(([^)]+)\)/) : null;
				const scale = m ? Number(m[1].split(',')[0]) : 0;
				const kind = layer ? layer.getAttribute('data-fab-kind') : null;
				w.__fabTabSamples!.push({ scale, kind });
				requestAnimationFrame(sample);
			};
			requestAnimationFrame(sample);
		});

		// Tap the discussions tab to start the cross-tab slide.
		await page.click('[data-tab-nav][href="/"]');
		await page.waitForURL((url) => url.pathname === '/');
		await page.waitForTimeout(200);

		const samples = (await page.evaluate(
			() =>
				(window as unknown as { __fabTabSamples?: Array<{ scale: number; kind: string | null }> })
					.__fabTabSamples
		))!;
		const scales = samples.map((s) => s.scale);
		const maxScale = scales.length ? Math.max(...scales) : 0;
		const kinds = samples.map((s) => s.kind);
		expect(
			maxScale,
			'FAB must scale in during the cross-tab slide (not frozen at 0)'
		).toBeGreaterThan(0.3);
		expect(kinds, 'the destination FAB kind (discussions) must appear').toContain('discussions');
	});

	test('desktop: the gesture pipeline is inert (no track transform, plain tab nav)', async ({
		page,
		context
	}) => {
		await prepareContext(context);
		// Desktop-width viewport: matchMedia('(max-width: 767px)') is false,
		// so isMobile is false and the orchestrator is not mounted. The
		// gesture pipeline is mobile-only (Plan §Scope).
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/messages/inbox');
		await waitForHydration(page);
		await page.click('a[href^="/messages/"]:not([href="/messages/new"]):not([href="/messages/inbox"])');
		await page.waitForURL(/\/messages\/\d+/);
		await page.waitForTimeout(500);

		// The track element has NO inline transform (the orchestrator never
		// wrote one on desktop - it is not mounted). This is the fix for the
		// desktop tab-click slide: with no orchestrator, no transition is
		// consumed, so any navigation is a plain SvelteKit nav.
		const transform = await page.locator('[data-testid="nav-pipeline-track"]').evaluate(
			(el) => getComputedStyle(el).transform
		);
		expect(transform, 'desktop track must have no transform').toBe('none');
	});

	test('cold deep-link landing rests at centre (no enter animation)', async ({ page, context }) => {
		await prepareContext(context);
		// Cold-load the pilot directly (no prior /messages/inbox in history).
		await page.goto('/messages/1');
		await waitForHydration(page);
		await page.waitForSelector('[data-testid="nav-pipeline-track"]');

		// Sample the track transform; a deep-link must NOT play the
		// forward-enter animation (shouldEnter is false: activeStack has no
		// prior entry). The track rests at the SSR translateX(-50%).
		await page.evaluate(() => {
			(window as any).__deepLinkSamples = [] as number[];
			const sample = () => {
				const track = document.querySelector('[data-testid="nav-pipeline-track"]');
				if (track) {
					(window as any).__deepLinkSamples.push(
						new DOMMatrix(getComputedStyle(track).transform).m41
					);
				}
				requestAnimationFrame(sample);
			};
			requestAnimationFrame(sample);
		});
		await page.waitForTimeout(500);

		const samples = (await page.evaluate(() => (window as any).__deepLinkSamples)) as number[];
		expect(samples.length, 'sampler should have captured track frames').toBeGreaterThan(3);
		// No enter animation: the track never moves (range ~0).
		const delta = Math.max(...samples) - Math.min(...samples);
		expect(delta, `deep-link must not play an enter animation (delta=${delta})`).toBeLessThan(20);
	});

	test('reduced-motion: back-swipe commit snaps (no rAF integration)', async ({ page, context }) => {
		await prepareContext(context);
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('/');
		await waitForHydration(page);
		await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(200);
		await page
			.locator('a[href^="/messages/"]:not([href="/messages/new"]):not([href="/messages/inbox"])')
			.first()
			.click();
		await page.waitForURL(/\/messages\/\d+/);
		await page.waitForSelector('.detail-scroll-pane');
		await page.waitForTimeout(500);

		// Sample the track m41. Under reduced-motion the commit SNAPS
		// (startCommit takes the snap path, no rAF): the track jumps from
		// the release position to the target in one frame, not a smooth
		// ~16-frame slide. A slow drag keeps the per-frame drag deltas
		// small, so the snap's single-frame jump dominates the max delta.
		await page.evaluate(() => {
			(window as any).__rmSamples = [] as number[];
			const sample = () => {
				const track = document.querySelector('[data-testid="nav-pipeline-track"]');
				if (track) {
					(window as any).__rmSamples.push(new DOMMatrix(getComputedStyle(track).transform).m41);
				}
				requestAnimationFrame(sample);
			};
			requestAnimationFrame(sample);
		});

		// 80px rightward drag (past SWIPE_COMMIT=60), slow (10 small moves).
		const client = await page.context().newCDPSession(page);
		await client.send('Emulation.setTouchEmulationEnabled', {
			enabled: true,
			maxTouchPoints: 5
		});
		const y = 400;
		const startX = 120;
		const endX = 200;
		const dispatch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, state: string) =>
			client.send('Input.dispatchTouchEvent', {
				type,
				touchPoints: [{ state, x, y, id: 1 }] as unknown as never,
				modifiers: 0,
				timestamp: 0
			});
		await dispatch('touchStart', startX, 'touchPressed');
		for (let i = 1; i <= 10; i++) {
			const x = Math.round(startX + (endX - startX) * (i / 10));
			await dispatch('touchMove', x, 'touchMoved');
		}
		await dispatch('touchEnd', endX, 'touchReleased');
		await client.detach();

		await page.waitForURL('**/messages/inbox', { timeout: 5000 });
		await page.waitForTimeout(300);

		expect(page.url(), 'reduced-motion commit must land on /messages/inbox').toMatch(
			/\/messages\/inbox/
		);
		const samples = (await page.evaluate(() => (window as any).__rmSamples)) as number[];
		expect(samples.length, 'sampler should have captured track frames').toBeGreaterThan(3);
		// Under reduced-motion the commit SNAPS synchronously (startCommit
		// takes the snap path, no rAF). Count frames where the track moved
		// significantly (> 5px): a snap produces 0-1 moving frames (the
		// snap is one synchronous write; whether the sampler catches it
		// depends on rAF-vs-nav timing); a smooth rAF slide produces
		// ~12-16 moving frames. This is robust to the timing either way.
		let movingFrames = 0;
		for (let i = 1; i < samples.length; i++) {
			if (Math.abs(samples[i] - samples[i - 1]) > 5) movingFrames++;
		}
		expect(
			movingFrames,
			`reduced-motion commit must snap, not slide (movingFrames=${movingFrames})`
		).toBeLessThanOrEqual(3);
	});

	// Velocity-matched commit coverage. The velocity-matched solver in
	// `solveCommitDuration` (nav-executor-logic) computes
	// T = 2 * |Δprogress| / |progressVelocity|, clamped to
	// [COMMIT_T_MIN_MS, COMMIT_T_MAX_MS]; a faster release velocity yields
	// a shorter commit slide. This test drives a fast flick and a slow
	// drag (varied via the CDP `timestamp` parameter so the swipe action's
	// releaseVelocity window sees a steep or shallow slope), then asserts
	// the slow release's commit slide produces MORE rAF frames than the
	// fast release's. Counting commit-phase frames (sampled between
	// touchEnd and the URL landing) isolates the commit slide from the
	// drag phase and the settle phase, so the assertion tracks the
	// solver's behaviour directly.

	interface VelocityCommitCapture {
		/** rAF frames captured between touchEnd and the URL landing, where
		 * the track was still moving (|delta from previous| > 5px). A
		 * longer commit produces more moving frames. */
		commitMovingFrames: number;
		totalFrames: number;
		commitFrameCount: number;
		endT: number;
		firstFrameT: number | null;
		lastFrameT: number | null;
		firstCommitM41: number | null;
		lastCommitM41: number | null;
		minCommitM41: number | null;
		maxCommitM41: number | null;
		ptrMoveCount: number;
		ptrFirstT: number | null;
		ptrLastT: number | null;
		ptrFirstX: number | null;
		ptrLastX: number | null;
		computedReleaseVel: number | null;
	}

	interface VelocitySamplerWindow extends Window {
		__velSampler?: {
			frames: { t: number; m41: number }[];
			armed: boolean;
			touchEndT: number | null;
		};
	}

	async function captureVelocityCommit(
		page: import('@playwright/test').Page,
		fast: boolean
	): Promise<VelocityCommitCapture> {
		await page.evaluate(() => {
			const w = window as unknown as VelocitySamplerWindow;
			w.__velSampler = { frames: [], armed: false, touchEndT: null };
			// Capture every pointermove + pointerup event's clientX + timeStamp
			// so the test can verify the releaseVelocity window saw the
			// intended fast / slow trajectory. The swipe action's onMove
			// pushes samples into its own array via event.timeStamp; this
			// listener is read-only and lets the test inspect the same data.
			(window as unknown as { __ptrEvents?: { x: number; t: number; type: string }[] }).__ptrEvents = [];
			const ptrListener = (e: PointerEvent): void => {
				const arr = (window as unknown as { __ptrEvents?: { x: number; t: number; type: string }[] }).__ptrEvents!;
				arr.push({ x: e.clientX, t: e.timeStamp, type: e.type });
			};
			document.addEventListener('pointermove', ptrListener, { capture: true });
			document.addEventListener('pointerup', ptrListener, { capture: true });
			const tick = (): void => {
				const s = w.__velSampler!;
				if (s.armed) {
					const track = document.querySelector('[data-testid="nav-pipeline-track"]');
					if (track) {
						let m41 = 0;
						try {
							m41 = new DOMMatrix(getComputedStyle(track).transform).m41;
						} catch {
							m41 = 0;
						}
						s.frames.push({ t: performance.now(), m41: Math.round(m41) });
					}
				}
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
		// Arm the sampler just before the drag starts so the touchEnd
		// marker lands inside the captured window.
		await page.evaluate(() => {
			(window as unknown as VelocitySamplerWindow).__velSampler!.armed = true;
		});

		const client = await page.context().newCDPSession(page);
		await client.send('Emulation.setTouchEmulationEnabled', {
			enabled: true,
			maxTouchPoints: 5
		});
		const y = 400;
		const startX = 120;
		const endX = 320;
		// CDP `Input.dispatchTouchEvent` accepts a `timestamp` in seconds,
		// interpreted as absolute seconds since the UNIX epoch. The default
		// `timestamp: 0` produces PointerEvents whose `timeStamp` is 0 for
		// every event, which collapses the swipe action's releaseVelocity
		// window (dt = 0 -> velocity 0). For this test we pass explicit
		// timestamps anchored at `Date.now()/1000` so Chrome derives
		// realistic `event.timeStamp` values that the releaseVelocity
		// window can differentiate. The fast variant spaces the touchmoves
		// 4ms apart (a 56ms total drag -> multi-px/ms slope); the slow
		// variant spaces them 40ms apart (a 560ms total drag -> sub-1
		// px/ms slope). The wall-clock dispatch is identical in both
		// variants (CDP round-trip overhead dominates either way), so the
		// velocity the solver sees comes from the synthetic timestamps,
		// not from Playwright timing.
		const originSec = Date.now() / 1000;
		const stepCount = 14;
		const stepSec = fast ? 0.004 : 0.04;
		const dispatchCdp = (
			type: 'touchStart' | 'touchMove' | 'touchEnd',
			x: number,
			state: string,
			tSec: number
		) =>
			client.send('Input.dispatchTouchEvent', {
				type,
				touchPoints: [{ state, x, y, id: 1 }] as unknown as never,
				modifiers: 0,
				timestamp: originSec + tSec
			});
		await dispatchCdp('touchStart', startX, 'touchPressed', 0);
		for (let i = 1; i <= stepCount; i++) {
			const x = Math.round(startX + (endX - startX) * (i / stepCount));
			await dispatchCdp('touchMove', x, 'touchMoved', i * stepSec);
		}
		// Stamp the touchEnd timestamp in page-clock (performance.now) so
		// the filter on captured frames uses one clock.
		await page.evaluate(() => {
			const s = (window as unknown as VelocitySamplerWindow).__velSampler!;
			s.touchEndT = performance.now();
		});
		await dispatchCdp('touchEnd', endX, 'touchReleased', stepCount * stepSec);
		await client.detach();
		await page.waitForURL('**/messages/inbox', { timeout: 5000 });
		// Allow the settle rAF to land so the sampler captures the whole
		// commit slide.
		await page.waitForTimeout(300);
		await page.evaluate(() => {
			(window as unknown as VelocitySamplerWindow).__velSampler!.armed = false;
		});

		return page.evaluate(() => {
			const s = (window as unknown as VelocitySamplerWindow).__velSampler!;
			const endT = s.touchEndT ?? 0;
			// Commit-phase frames only: those at or after touchEnd.
			const commitFrames = s.frames.filter((f) => f.t >= endT);
			let moving = 0;
			for (let i = 1; i < commitFrames.length; i++) {
				if (Math.abs(commitFrames[i].m41 - commitFrames[i - 1].m41) > 5) moving++;
			}
			const ptr = (window as unknown as { __ptrEvents?: { x: number; t: number; type: string }[] }).__ptrEvents ?? [];
			// Compute the releaseVelocity from the captured pointer samples
			// using the same 80ms trailing window as the swipe action, so the
			// test can see whether the fast / slow variants produced the
			// intended velocity delta.
			const moves = ptr.filter((p) => p.type === 'pointermove');
			const ups = ptr.filter((p) => p.type === 'pointerup');
			let computedVel = null;
			if (moves.length >= 2 && ups.length > 0) {
				const last = moves[moves.length - 1];
				const cutoff = last.t - 80;
				let i = 0;
				while (i < moves.length - 2 && moves[i].t < cutoff) i++;
				const first = moves[i];
				const dt = last.t - first.t;
				computedVel = dt > 0 ? (last.x - first.x) / dt : null;
			}
			return {
				commitMovingFrames: moving,
				totalFrames: s.frames.length,
				commitFrameCount: commitFrames.length,
				endT: Math.round(endT),
				firstFrameT: s.frames[0] ? Math.round(s.frames[0].t) : null,
				lastFrameT: s.frames.length ? Math.round(s.frames[s.frames.length - 1].t) : null,
				firstCommitM41: commitFrames[0]?.m41 ?? null,
				lastCommitM41: commitFrames[commitFrames.length - 1]?.m41 ?? null,
				minCommitM41: commitFrames.length ? Math.min(...commitFrames.map((f) => f.m41)) : null,
				maxCommitM41: commitFrames.length ? Math.max(...commitFrames.map((f) => f.m41)) : null,
				ptrMoveCount: moves.length,
				ptrFirstT: moves[0]?.t ?? null,
				ptrLastT: moves[moves.length - 1]?.t ?? null,
				ptrFirstX: moves[0]?.x ?? null,
				ptrLastX: moves[moves.length - 1]?.x ?? null,
				computedReleaseVel: computedVel === null ? null : Math.round(computedVel * 1000) / 1000
			};
		});
	}

	test('velocity-matched commit: fast flick yields fewer commit frames than slow drag', async ({
		page,
		context
	}) => {
		await prepareContext(context);
		await page.goto('/');
		await waitForHydration(page);
		await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(200);
		await page
			.locator('a[href^="/messages/"]:not([href="/messages/inbox"]):not([href="/messages/new"])')
			.first()
			.click();
		await page.waitForURL(/\/messages\/\d+/);
		await page.waitForSelector('.detail-scroll-pane');
		await page.waitForTimeout(500);

		const fast = await captureVelocityCommit(page, true);

		// Re-enter the pilot for the slow variant. The fast swipe landed on
		// /messages/inbox; click the same conversation to return to the
		// pilot route.
		await page
			.locator('a[href^="/messages/"]:not([href="/messages/inbox"]):not([href="/messages/new"])')
			.first()
			.click();
		await page.waitForURL(/\/messages\/\d+/);
		await page.waitForSelector('.detail-scroll-pane');
		await page.waitForTimeout(500);

		const slow = await captureVelocityCommit(page, false);

		// The relative assertion (slow > fast) tracks the velocity-matched
		// solver: a slow release's commit slide integrates over more rAF
		// ticks than a fast release's. The fast variant's 4ms step spacing
		// yields a multi-px/ms releaseVelocity (near
		// COMMIT_VELOCITY_CLAMP), so the solver's T = 2 * |Δprogress| /
		// |progressVel| lands near COMMIT_T_MIN_MS. The slow variant's
		// 40ms spacing yields a sub-1 px/ms velocity; the solver's T
		// exceeds COMMIT_T_MAX_MS and clamps. The result is a 3x commit
		// frame delta (slow ~21 moving frames vs fast ~7), well above the
		// rAF-sampling noise floor.
		expect(
			slow.commitMovingFrames,
			`slow drag commit must produce more moving frames than fast flick ` +
				`(fast=${fast.commitMovingFrames}, slow=${slow.commitMovingFrames}, ` +
				`fastVel=${fast.computedReleaseVel}, slowVel=${slow.computedReleaseVel})`
		).toBeGreaterThan(fast.commitMovingFrames);
	});

	// DV21 R1 continuity guard: the centerTab -> tab-root back-swipe
	// (`/messages/<id>` -> `/messages/inbox`) must keep the vertical-channel
	// morph continuous across the whole gesture (drag + release + commit).
	// The drag branch eases the morph via `1 - backMorph` (gesture feedback:
	// the icon rotates from hamburger toward back-arrow as the swipe
	// advances, and the tab-bar translateY descends); the settle that takes
	// over at release must interpolate from the captured `startMorph` (the
	// drag's terminal value) toward the destination's at-rest morph across
	// `settleMorphFraction`, never collapsing to a constant that disagrees
	// with the drag's terminal value (which would snap the icon
	// `backMorph * 180deg` -> 0deg and the tab-bar translateY
	// `-backMorph * 100%` -> `0%` in one rAF frame at release).
	test('centerTab -> tab-root back-swipe keeps the vertical morph continuous across the release handoff', async ({
		page
	}) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(200);
		await page
			.locator('a[href^="/messages/"]:not([href="/messages/inbox"]):not([href="/messages/new"])')
			.first()
			.click();
		await page.waitForURL(/\/messages\/\d+/);
		await page.waitForSelector('.detail-scroll-pane');
		await page.waitForTimeout(500);

		await installMultiSignalSampler(page, 2200);
		await swipeBack(page);
		await waitForMultiSignalDone(page);
		const frames = await readMultiSignalFrames(page);

		const rootJumps = maxFrameJumps(frames, (f) => f.rootLayerTy);
		const deepJumps = maxFrameJumps(frames, (f) => f.deepLayerTy);
		const burgerJumps = maxFrameJumps(frames, (f) => f.burgerRot);
		console.log('centerTab -> tab-root continuity:', {
			rootJumps,
			deepJumps,
			burgerJumps,
			finalPath: new URL(page.url()).pathname
		});

		expect(page.url(), 'back-swipe must land on /messages/inbox').toMatch(/\/messages\/inbox/);
		// The threshold allows one rAF of regular progress (~3px / ~13deg
		// at this viewport's header height); a snap lands ~26px / ~119deg.
		expect(
			rootJumps.max,
			`rootLayerTy must not snap at release (max jump ${rootJumps.max.toFixed(2)}px at t=${rootJumps.maxAt}ms)`
		).toBeLessThan(15);
		expect(
			burgerJumps.max,
			`burgerRot must not snap at release (max jump ${burgerJumps.max.toFixed(2)}deg at t=${burgerJumps.maxAt}ms)`
		).toBeLessThan(35);
	});

	// DV21 R4 F2 continuity guard: a re-grab mid-commit (the user releases
	// past SWIPE_COMMIT then immediately presses again while the commit
	// slide is still running) takes over the in-flight settle. The drag's
	// morph formula (`currentHasTabs ? 1 - bm : bm`) agrees with the
	// settle's terminal value at the release instant but diverges
	// mid-commit because the settle interpolates toward
	// `destMorph = atRestMorph(incoming)` while the drag formula travels
	// toward the opposite end. Without the `dragMorphAnchor` capture in
	// `#beginGesture` the drag recomputes the morph from `bm` and snaps
	// (~180deg icon + ~40px layer snap at this viewport). With the anchor,
	// the drag's natural curve is shifted to pass through the settle's
	// current morph at the takeover instant, keeping the morph continuous
	// at the settle-to-drag boundary.
	//
	// Gesture driver: the two swipes share a SINGLE CDP touch session so
	// the second `touchStart` lands within the first commit's ~300ms
	// window with no Playwright async gap. Two separate `swipeBack`
	// calls each open their own session and the await between them leaks
	// wallclock (the commit's rAF often completes before the second
	// `touchStart` arrives, leaving the intent state machine in `idle`
	// and the second `#beginGesture` capture unreachable).
	test('re-grab mid-commit keeps the vertical morph continuous at the settle-to-drag handoff', async ({
		page,
		context
	}) => {
		await prepareContext(context);
		await page.goto('/');
		await waitForHydration(page);
		await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(200);
		await page
			.locator('a[href^="/messages/"]:not([href="/messages/inbox"]):not([href="/messages/new"])')
			.first()
			.click();
		await page.waitForURL(/\/messages\/\d+/);
		await page.waitForSelector('.detail-scroll-pane');
		await page.waitForTimeout(500);

		await installMultiSignalSampler(page, 2400);
		// First swipe releases past SWIPE_COMMIT -> the commit slide and
		// its settle start. The second swipe re-grabs mid-commit; its
		// `#beginGesture` captures `dragMorphAnchor` from the settle's
		// current morph (the visual the Header is rendering the instant
		// before the drag took over).
		const client = await page.context().newCDPSession(page);
		await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
		const width = page.viewportSize()?.width ?? 393;
		const touch = (
			type: 'touchStart' | 'touchMove' | 'touchEnd',
			x: number,
			state: string
		) =>
			client.send('Input.dispatchTouchEvent', {
				type,
				touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
				modifiers: 0,
				timestamp: 0
			});
		// Phase 1: rightward back-swipe past SWIPE_COMMIT -> commit starts.
		const firstStart = Math.round(width * 0.3);
		const firstEnd = firstStart + 240;
		await touch('touchStart', firstStart, 'touchPressed');
		for (let i = 1; i <= 10; i++) {
			await touch('touchMove', firstStart + Math.round(((firstEnd - firstStart) * i) / 10), 'touchMoved');
		}
		await touch('touchEnd', firstEnd, 'touchReleased');
		// Phase 2 (same CDP session, no async gap): a second rightward
		// swipe that re-grabs while the first commit's settle is still
		// running. `#beginGesture` captures `dragMorphAnchor` from the
		// settle's morph at the takeover instant; the drag's shifted
		// formula then tracks the live finger.
		const secondStart = Math.round(width * 0.3);
		const secondEnd = secondStart + 240;
		await touch('touchStart', secondStart, 'touchPressed');
		for (let i = 1; i <= 10; i++) {
			await touch('touchMove', secondStart + Math.round(((secondEnd - secondStart) * i) / 10), 'touchMoved');
		}
		await touch('touchEnd', secondEnd, 'touchReleased');
		await client.detach();
		await waitForMultiSignalDone(page);
		const frames = await readMultiSignalFrames(page);

		const rootJumps = maxFrameJumps(frames, (f) => f.rootLayerTy);
		const burgerJumps = maxFrameJumps(frames, (f) => f.burgerRot);
		console.log('re-grab mid-commit continuity:', {
			rootJumps,
			burgerJumps,
			finalPath: new URL(page.url()).pathname
		});

		// The threshold allows one rAF of regular progress (~3px / ~13deg
		// at this viewport's header height); the R4-audit snap was
		// ~40px / ~180deg at the re-grab boundary.
		expect(
			rootJumps.max,
			`rootLayerTy must not snap at the re-grab (max jump ${rootJumps.max.toFixed(2)}px at t=${rootJumps.maxAt}ms)`
		).toBeLessThan(15);
		expect(
			burgerJumps.max,
			`burgerRot must not snap at the re-grab (max jump ${burgerJumps.max.toFixed(2)}deg at t=${burgerJumps.maxAt}ms)`
		).toBeLessThan(35);
	});

	// DV21 R4 F3 continuity guard: a back-swipe started during a
	// forward-enter to a centerTab route takes over the enter's settle.
	// `playEnterAnimation` arms a settle with
	// `startMorph = destMorph = atRestMorph(outgoingHasTabs) = 1` for a
	// forward-enter to a centerTab route; a back-swipe started mid-enter
	// cancels the settle and seeds `bm = the enter's eased progress (> 0)`,
	// so the drag branch would recompute `morph = 1 - bm` and snap from 1
	// toward 0 without the `dragMorphAnchor` capture (a ~103deg icon snap at
	// this viewport). With the anchor, the drag curve shifts to pass
	// through the settle's current morph (the value the enter was rendering
	// at the takeover instant), keeping the morph continuous. The
	// companion drag-to-settle snap at commit (a saturated drag where
	// `startProgress === targetProgress === 1`) is handled by the
	// orchestrator publishing a separate eased-fraction field that
	// animates 0 -> 1 across the settle's full duration independent of the
	// raw progress scale.
	test('gesture-during-forward-enter keeps the vertical morph continuous at the enter-to-drag handoff', async ({
		page,
		context
	}) => {
		await prepareContext(context);
		await page.goto('/');
		await waitForHydration(page);
		await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(200);

		await installMultiSignalSampler(page, 2400);
		// Click a conversation link to trigger the forward-enter to
		// /messages/<id>. `playEnterAnimation` arms the settle on the
		// destination host once it mounts (the click's discrete-nav path
		// does NOT arm a settle for centerTab routes since
		// `outgoingHasTabs === incomingHasTabs === true`).
		await page
			.locator('a[href^="/messages/"]:not([href="/messages/inbox"]):not([href="/messages/new"])')
			.first()
			.click();
		// Wait briefly so the back-swipe lands inside the enter's settle
		// window (~200-300ms). The exact offset is not load-bearing: any
		// point inside the settle window captures the anchor and verifies
		// continuity; the test samples across the whole 2400ms window so
		// any later morph motion is also captured.
		await page.waitForTimeout(60);
		await swipeBack(page);
		await waitForMultiSignalDone(page);
		const frames = await readMultiSignalFrames(page);

		const rootJumps = maxFrameJumps(frames, (f) => f.rootLayerTy);
		const burgerJumps = maxFrameJumps(frames, (f) => f.burgerRot);
		console.log('gesture-during-forward-enter continuity:', {
			rootJumps,
			burgerJumps,
			finalPath: new URL(page.url()).pathname
		});

		// The threshold allows one rAF of regular progress (~3px / ~13deg
		// at this viewport's header height); the formalized guard's suite-context BEFORE is ~103deg
		// at the takeover boundary.
		expect(
			rootJumps.max,
			`rootLayerTy must not snap at the enter-to-drag handoff (max jump ${rootJumps.max.toFixed(2)}px at t=${rootJumps.maxAt}ms)`
		).toBeLessThan(15);
		expect(
			burgerJumps.max,
			`burgerRot must not snap at the enter-to-drag handoff (max jump ${burgerJumps.max.toFixed(2)}deg at t=${burgerJumps.maxAt}ms)`
		).toBeLessThan(35);
	});

	// DV21 R5 A-F1 continuity guard: a discrete nav (programmatic
	// `__e2eGoto`) fired mid-swipe on a centerTab route whose
	// `dragMorphAnchor` was captured by the gesture-during-forward-enter
	// path. Both source (`/messages/<id>`, centerTab=2) and destination
	// (`/`, the discussions tab root) have `hasTabs = true`, so the
	// discrete-nav arm's morph visibly does NOT change at rest; without
	// the live-drag awareness the settle arm would be skipped, leaving
	// the morph to snap from the live anchor-shifted value to the
	// at-rest value in one rAF frame at the drag-to-discrete-nav
	// handoff. The orchestrator's settle arm fires whenever
	// `liveDragMorph !== sourceRest || liveDragMorph !== destMorph`
	// (subsuming the tab-ness-change case where the at-rests differ,
	// the same-tab-ness + live-drag case where the live value differs
	// from the source's at-rest, and the saturated tab-ness-change
	// case where the live value equals the destination's at-rest but
	// differs from the source's), easing the morph across the slide's
	// duration. The discrete nav is fired via the SAME CDP session's
	// `Runtime.evaluate` between `touchMove` and `touchEnd` so the
	// touch / goto ordering is deterministic (a Playwright
	// `page.evaluate` between CDP touch events would use a separate IPC
	// channel and could land after the `touchEnd`). The formalized
	// guard's BEFORE is ~66deg / ~15px; the R5 fix reduces both to within
	// the regular per-rAF cadence (~13deg / ~3px at this viewport's
	// header height).
	test('drag-to-discrete-nav handoff keeps the vertical morph continuous at the interrupt (R5 A-F1)', async ({
		page,
		context
	}) => {
		await prepareContext(context);
		await page.goto('/');
		await waitForHydration(page);
		await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(200);

		await installMultiSignalSampler(page, 3000);
		// Click a conversation link to trigger the forward-enter to
		// /messages/<id>. The destination's playEnterAnimation arms a
		// settle with startMorph = destMorph = atRestMorph(true) = 1.
		await page
			.locator('a[href^="/messages/"]:not([href="/messages/inbox"]):not([href="/messages/new"])')
			.first()
			.click();
		await page.waitForURL(/\/messages\/\d+/);
		await page.waitForSelector('.detail-scroll-pane');
		// Wait briefly so the back-swipe lands inside the enter's settle
		// window AND the drag saturates before the discrete nav fires.
		await page.waitForTimeout(60);

		// Single CDP session for both touch events and the goto call so
		// the ordering is preserved (touchMove -> goto -> touchEnd).
		const client = await page.context().newCDPSession(page);
		await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
		const width = page.viewportSize()?.width ?? 393;
		const startX = Math.round(width * 0.3);
		const endX = startX + 240;
		const touch = (
			type: 'touchStart' | 'touchMove' | 'touchEnd',
			x: number,
			state: string
		) =>
			client.send('Input.dispatchTouchEvent', {
				type,
				touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
				modifiers: 0,
				timestamp: 0
			});
		await touch('touchStart', startX, 'touchPressed');
		for (let i = 1; i <= 10; i++) {
			await touch('touchMove', startX + Math.round(((endX - startX) * i) / 10), 'touchMoved');
			// Fire the discrete nav partway through the swipe (after the
			// 6th touchMove, when the drag is well past midpoint).
			if (i === 6) {
				await client.send('Runtime.evaluate', {
					expression: `window.__e2eGoto('/')`,
					awaitPromise: false
				});
			}
		}
		await touch('touchEnd', endX, 'touchReleased');
		await client.detach();
		await waitForMultiSignalDone(page);
		const frames = await readMultiSignalFrames(page);

		const rootJumps = maxFrameJumps(frames, (f) => f.rootLayerTy);
		const burgerJumps = maxFrameJumps(frames, (f) => f.burgerRot);
		console.log('drag-to-discrete-nav continuity:', {
			rootJumps,
			burgerJumps,
			finalPath: new URL(page.url()).pathname
		});

		// The threshold allows one rAF of regular progress (~3px / ~13deg
		// at this viewport's header height); the formalized guard's
		// BEFORE was ~66deg / ~15px.
		expect(
			rootJumps.max,
			`rootLayerTy must not snap at the drag-to-discrete-nav handoff (max jump ${rootJumps.max.toFixed(2)}px at t=${rootJumps.maxAt}ms)`
		).toBeLessThan(15);
		expect(
			burgerJumps.max,
			`burgerRot must not snap at the drag-to-discrete-nav handoff (max jump ${burgerJumps.max.toFixed(2)}deg at t=${burgerJumps.maxAt}ms)`
		).toBeLessThan(35);
	});

	// DV21 R6 B-F1 continuity guard (centerTab/tab -> deep): a SATURATED
	// back-swipe on `/messages/<id>` (centerTab=2, hasTabs=true) whose
	// terminal drag morph coincidentally equals the destination's
	// at-rest morph (at raw=1, `1 - raw = 0 = atRestMorph(false)` for
	// `/bookmarks`). The `liveDragMorph !== destMorph` clause alone
	// collapses to equality (0 === 0); without the
	// `liveDragMorph !== sourceRest` clause the settle arm would be
	// SKIPPED, leaving the morph derivation's at-rest branch to return
	// the SOURCE's at-rest morph (`currentHasTabs ? 1 : 0` = 1, the URL
	// has not changed yet), snapping the icon 0 -> 180deg and the
	// tab-bar `translateY` 0 -> -100% in one rAF frame at the
	// drag-to-discrete-nav handoff. The orchestrator's settle arm fires
	// whenever
	// `liveDragMorph !== sourceRest || liveDragMorph !== destMorph`;
	// the first clause fires for this shape (liveDragMorph=0,
	// sourceRest=1), easing the morph across the slide's duration. The
	// drag saturates by travelling the full viewport width (raw clamps
	// to 1). The discrete nav is fired via the SAME CDP session's
	// `Runtime.evaluate` between the last `touchMove` and `touchEnd` so
	// the touch / goto ordering is deterministic.
	test('saturated drag interrupted by a tab-ness-changing discrete nav keeps the vertical morph continuous (R6 B-F1 centerTab -> deep)', async ({
		page,
		context
	}) => {
		await prepareContext(context);
		await page.goto('/');
		await waitForHydration(page);
		await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(200);
		await page
			.locator('a[href^="/messages/"]:not([href="/messages/inbox"]):not([href="/messages/new"])')
			.first()
			.click();
		await page.waitForURL(/\/messages\/\d+/);
		await page.waitForSelector('.detail-scroll-pane');
		await page.waitForTimeout(300);

		await installMultiSignalSampler(page, 3000);
		// Single CDP session for both touch events and the goto call so
		// the ordering is preserved (touchMove -> goto -> touchEnd).
		const client = await page.context().newCDPSession(page);
		await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
		const width = page.viewportSize()?.width ?? 393;
		// Drag the full viewport width so raw clamps to 1 (saturated).
		const startX = Math.round(width * 0.2);
		const endX = startX + width;
		const touch = (
			type: 'touchStart' | 'touchMove' | 'touchEnd',
			x: number,
			state: string
		) =>
			client.send('Input.dispatchTouchEvent', {
				type,
				touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
				modifiers: 0,
				timestamp: 0
			});
		await touch('touchStart', startX, 'touchPressed');
		for (let i = 1; i <= 10; i++) {
			await touch('touchMove', startX + Math.round(((endX - startX) * i) / 10), 'touchMoved');
			// Fire the tab-ness-changing discrete nav on the LAST
			// touchMove so the drag is saturated (raw=1) when the
			// interrupt arrives and the touchEnd follows deterministically.
			if (i === 10) {
				await client.send('Runtime.evaluate', {
					expression: `window.__e2eGoto('/bookmarks')`,
					awaitPromise: false
				});
			}
		}
		await touch('touchEnd', endX, 'touchReleased');
		await client.detach();
		await waitForMultiSignalDone(page);
		const frames = await readMultiSignalFrames(page);

		const rootJumps = maxFrameJumps(frames, (f) => f.rootLayerTy);
		const burgerJumps = maxFrameJumps(frames, (f) => f.burgerRot);
		console.log('saturated centerTab -> deep continuity:', {
			rootJumps,
			burgerJumps,
			finalPath: new URL(page.url()).pathname
		});

		expect(
			rootJumps.max,
			`rootLayerTy must not snap at the saturated-drag handoff (max jump ${rootJumps.max.toFixed(2)}px at t=${rootJumps.maxAt}ms)`
		).toBeLessThan(15);
		expect(
			burgerJumps.max,
			`burgerRot must not snap at the saturated-drag handoff (max jump ${burgerJumps.max.toFixed(2)}deg at t=${burgerJumps.maxAt}ms)`
		).toBeLessThan(35);
	});

	// DV21 R6 B-F1 continuity guard (deep -> tab): the symmetric shape.
	// A SATURATED back-swipe on `/profile/settings` (hasTabs=false) whose
	// terminal drag morph coincidentally equals the destination's
	// at-rest morph (at raw=1, `raw = 1 = atRestMorph(true)` for
	// `/messages/inbox`). The `liveDragMorph !== destMorph` clause alone
	// collapses to equality (1 === 1); without the
	// `liveDragMorph !== sourceRest` clause the settle arm would be
	// SKIPPED, leaving the morph derivation's at-rest branch to return
	// the SOURCE's at-rest morph (`currentHasTabs ? 1 : 0` = 0, the URL
	// has not changed yet), snapping the icon 180 -> 0deg and the
	// tab-bar `translateY` -100% -> 0% in one rAF frame at the
	// drag-to-discrete-nav handoff. The first clause
	// (`liveDragMorph !== sourceRest`, 1 !== 0) fires for this shape,
	// easing the morph across the slide's duration.
	test('saturated drag interrupted by a tab-ness-changing discrete nav keeps the vertical morph continuous (R6 B-F1 deep -> tab)', async ({
		page,
		context
	}) => {
		await prepareContext(context);
		await page.goto('/profile/settings');
		await waitForHydration(page);
		await page.waitForTimeout(300);

		await installMultiSignalSampler(page, 3000);
		const client = await page.context().newCDPSession(page);
		await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
		const width = page.viewportSize()?.width ?? 393;
		const startX = Math.round(width * 0.2);
		const endX = startX + width;
		const touch = (
			type: 'touchStart' | 'touchMove' | 'touchEnd',
			x: number,
			state: string
		) =>
			client.send('Input.dispatchTouchEvent', {
				type,
				touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
				modifiers: 0,
				timestamp: 0
			});
		await touch('touchStart', startX, 'touchPressed');
		for (let i = 1; i <= 10; i++) {
			await touch('touchMove', startX + Math.round(((endX - startX) * i) / 10), 'touchMoved');
			if (i === 10) {
				await client.send('Runtime.evaluate', {
					expression: `window.__e2eGoto('/messages/inbox')`,
					awaitPromise: false
				});
			}
		}
		await touch('touchEnd', endX, 'touchReleased');
		await client.detach();
		await waitForMultiSignalDone(page);
		const frames = await readMultiSignalFrames(page);

		const rootJumps = maxFrameJumps(frames, (f) => f.rootLayerTy);
		const burgerJumps = maxFrameJumps(frames, (f) => f.burgerRot);
		console.log('saturated deep -> tab continuity:', {
			rootJumps,
			burgerJumps,
			finalPath: new URL(page.url()).pathname
		});

		expect(
			rootJumps.max,
			`rootLayerTy must not snap at the saturated-drag handoff (max jump ${rootJumps.max.toFixed(2)}px at t=${rootJumps.maxAt}ms)`
		).toBeLessThan(15);
		expect(
			burgerJumps.max,
			`burgerRot must not snap at the saturated-drag handoff (max jump ${burgerJumps.max.toFixed(2)}deg at t=${burgerJumps.maxAt}ms)`
		).toBeLessThan(35);
	});

	// DV21 R7 B-F1 title-span continuity guard: a back-swipe on
	// `/profile/password` (deep, hasTabs=false) toward `/profile/settings`
	// (deep) interrupted mid-drag by `__e2eGoto('/')` (a deep -> tab-root
	// discrete nav). The drag publishes `pager.backMorph` and the Header's
	// title spans read it directly via `titleView.progress` (the drag branch
	// of the title view derivation). The settle that takes over at the
	// discrete-nav arm reads `settleProgress` (the rAF-tick value on the
	// raw scale, shared with `pager.backMorph`). The discrete-nav arm seeds
	// `settleStartProgress` from the visual-derived `startProgress`
	// (`#startProgressFromCurrentVisual`) so the first settle frame's
	// `settleProgress` equals the drag's terminal `pager.backMorph` and the
	// title spans stay continuous at the handoff (DV21 §5). Seeding
	// `settleStartProgress = 0` instead would publish `settleProgress = 0`
	// at the first settle frame, snapping the outgoing / incoming
	// `translateY` from `pager.backMorph * headerHeight` to 0 in one rAF
	// (~15px at the 40px header height). The from-rest tab-click path
	// collapses to `startProgress = 0` (no live drag owns the visual), so
	// the from-rest discrete-nav behaviour is preserved.
	//
	// The sampler targets the title-span PARENT divs (the
	// `div.absolute.inset-0.flex.items-center.justify-center.px-2` children
	// of the layer-down div) - NOT the root or deep layers themselves. Those
	// parent divs carry the inline `transform: translateY(...)` driven by
	// `titleView.progress`, which is the signal seeded by `startProgress`.
	// The root / deep layer transforms are driven by `morph`; their
	// continuity at the drag-to-discrete-nav handoff is owned by the
	// R5 A-F1 and R6 B-F1 guards above.
	test('drag-to-discrete-nav handoff keeps the title spans continuous at the interrupt (R7 B-F1)', async ({
		page,
		context
	}) => {
		await prepareContext(context);
		// Deep->deep SPA stack: / -> /profile/settings -> /profile/password.
		// `/profile/password`'s back-target is `/profile/settings`, so a
		// back-swipe starts as a deep -> deep drag (both endpoints have no
		// tabs). The drag publishes live `pager.backMorph` (the non-centerTab
		// non-tab-to-tab branch of `#republishToPager`), which the title
		// spans read via `titleView.progress`.
		await page.goto('/');
		await waitForHydration(page);
		await openSidebarAndGoto(page, '/profile/settings');
		await openSidebarAndGoto(page, '/profile/password');
		await page.waitForSelector('.detail-scroll-pane');
		await page.waitForTimeout(300);

		// Install a rAF sampler that records each title-span parent div's
		// transform m42 (the translateY in px) every frame across a 3000ms
		// window. The selector finds the deep layer's title-span parent
		// divs (the children of the layer-down div).
		await page.evaluate(() => {
			const w = window as unknown as {
				__titleSpanSampler?: {
					frames: { t: number; tys: number[] }[];
					done: boolean;
				};
			};
			w.__titleSpanSampler = { frames: [], done: false };
			const start = performance.now();
			const tick = (): void => {
				const s = w.__titleSpanSampler!;
				// The layer-down div is the second direct child with both
				// `absolute inset-0` and `px-2` (the root-layer div lacks
				// `px-2`). Its direct children are the 1 (at-rest) or 2
				// (during a drag / settle crossfade) title-span parent
				// divs.
				const layerDown = document.querySelector(
					'header div.relative.h-10.flex-1 > div.absolute.inset-0.px-2'
				);
				const spans = layerDown
					? Array.from(layerDown.querySelectorAll<HTMLElement>(':scope > div.absolute.inset-0'))
					: [];
				const tys: number[] = [];
				for (const el of spans) {
					const tr = getComputedStyle(el).transform;
					if (tr === 'none') {
						tys.push(0);
						continue;
					}
					try {
						tys.push(new DOMMatrix(tr).m42);
					} catch {
						tys.push(0);
					}
				}
				s.frames.push({ t: Math.round(performance.now() - start), tys });
				if (performance.now() - start > 3000) {
					s.done = true;
					return;
				}
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});

		// Single CDP session for both touch events and the goto call so the
		// ordering is preserved (touchMove -> goto -> touchEnd). A Playwright
		// `page.evaluate` between CDP touch events uses a separate IPC channel
		// and could land after the `touchEnd`.
		const client = await page.context().newCDPSession(page);
		await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
		const width = page.viewportSize()?.width ?? 393;
		const startX = Math.round(width * 0.3);
		const endX = startX + 240;
		const touch = (
			type: 'touchStart' | 'touchMove' | 'touchEnd',
			x: number,
			state: string
		) =>
			client.send('Input.dispatchTouchEvent', {
				type,
				touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
				modifiers: 0,
				timestamp: 0
			});
		await touch('touchStart', startX, 'touchPressed');
		for (let i = 1; i <= 10; i++) {
			await touch('touchMove', startX + Math.round(((endX - startX) * i) / 10), 'touchMoved');
			// Fire the tab-ness-changing discrete nav partway through the
			// swipe (after the 6th touchMove, when the drag is well past
			// midpoint and `pager.backMorph` is materially away from 0/1).
			if (i === 6) {
				await client.send('Runtime.evaluate', {
					expression: `window.__e2eGoto('/')`,
					awaitPromise: false
				});
			}
		}
		await touch('touchEnd', endX, 'touchReleased');
		await client.detach();
		await page.waitForFunction(
			() =>
				(window as unknown as { __titleSpanSampler?: { done?: boolean } }).__titleSpanSampler?.done ===
				true,
			{ timeout: 10_000 }
		);
		const frames = await page.evaluate(() => {
			const w = window as unknown as { __titleSpanSampler?: { frames: { t: number; tys: number[] }[] } };
			return w.__titleSpanSampler?.frames ?? [];
		});

		// Max frame-to-frame jump across the crossfade window. Only frames
		// with exactly 2 title spans (outgoing at index 0, incoming at index
		// 1) are compared: the audit's continuity claim is about the
		// crossfade period, and the at-rest state (1 span) enters / exits
		// the crossfade by adding / removing the off-screen outgoing span,
		// which would otherwise pair the outgoing span's off-screen
		// `translateY` with the at-rest single span's centered `translateY`
		// and report a false positive (the outgoing span is removed when it
		// is already off-screen, so no visible snap occurs).
		let maxJump = 0;
		let maxAt = 0;
		let prevTys: number[] | null = null;
		for (const f of frames) {
			if (f.tys.length !== 2) {
				prevTys = null;
				continue;
			}
			if (prevTys !== null) {
				for (let i = 0; i < 2; i++) {
					const a = prevTys[i];
					const b = f.tys[i];
					if (a !== undefined && b !== undefined) {
						const d = Math.abs(b - a);
						if (d > maxJump) {
							maxJump = d;
							maxAt = f.t;
						}
					}
				}
			}
			prevTys = f.tys;
		}
		console.log('drag-to-discrete-nav title-span continuity:', {
			maxJump: Math.round(maxJump * 100) / 100,
			maxAt,
			frameCount: frames.length,
			finalPath: new URL(page.url()).pathname
		});

		// The threshold allows one rAF of regular progress at the 40px header
		// height; the no-fix snap (seeding `settleStartProgress = 0` instead
		// of the visual-derived `startProgress`) lands ~15px at the
		// drag-to-discrete-nav handoff.
		expect(
			maxJump,
			`title span translateY must not snap at the drag-to-discrete-nav handoff (max jump ${maxJump.toFixed(2)}px at t=${maxAt}ms)`
		).toBeLessThan(12);
	});
});

/** Compute the max frame-to-frame absolute jump of a sampled signal across
 *  the multi-signal frame series, plus the timestamp of that max jump. Null
 *  samples (signal absent in that frame) are skipped. Used by the no-snap
 *  guards to assert the morph stays continuous across the drag-to-settle
 *  release boundary (a snap shows up as one frame's delta dwarfing the
 *  regular per-rAF cadence). */
function maxFrameJumps(
	frames: MultiSignalFrame[],
	pick: (f: MultiSignalFrame) => number | null
): { max: number; maxAt: number } {
	let max = 0;
	let maxAt = 0;
	let prev: number | null = null;
	for (const f of frames) {
		const v = pick(f);
		if (v === null) {
			prev = null;
			continue;
		}
		if (prev !== null) {
			const d = Math.abs(v - prev);
			if (d > max) {
				max = d;
				maxAt = f.t;
			}
		}
		prev = v;
	}
	return { max, maxAt };
}


// DV21 R8-A F1 + F3 continuity guard: an opposite-direction re-grab whose
// new gesture is a forward-swipe-to-`/search` from `/messages/inbox` (the
// last tab). The first gesture (a back-swipe toward `/bookmarks`) commits
// and starts its settle. Mid-settle the user re-grabs forward; the
// new gesture's plan resolves `targetIsSearch = true`. The orchestrator's
// `#beginGesture` captures both `dragMorphAnchor` (for the Header morph
// derivation) and `dragFabAnchor` (for the FAB scale derivation) at the
// takeover instant. The Header's `targetIsSearch` short-circuit honors
// the morph anchor (R8-A F1) and the FAB layer's scale derivation applies
// the shift formula through the FAB anchor (R8-A F3), so both the
// vertical morph and the FAB scale stay continuous across the direction
// reversal. The audit's BEFORE evidence was a 26px rootLayerTy / 119deg
// burgerRot / 0.89 fabScale snap at t=498ms; the fix reduces all three to
// within the regular per-rAF cadence (~3px / ~13deg / ~0.12 scale at
// this viewport). Single CDP session for both swipes so the re-grab lands
// inside the first commit's ~300ms window with no Playwright async gap.
test('opposite-direction re-grab into a forward-swipe-to-/search keeps the morph and FAB continuous (R8-A F1 + F3)', async ({
	page,
	context
}) => {
	await prepareContext(context);
	// Navigate via full page go tos so previousEntryPathname() on
	// `/messages/inbox` is non-null AND non-tab: the bidirectional host
	// resolves a backward gesture to the temporal-previous
	// (`/bookmarks`, a deep page), which publishes live
	// `backMorph: rawDragFraction` so the morph derivation's bm !== null
	// branch tracks the drag and the settle at release eases toward
	// `atRestMorph(false) = 0`. A tab-to-tab previous (e.g. `/`) would
	// publish `backMorph: null` (the bidirectional host's tab-to-tab
	// publication rule), leaving the morph at the at-rest value across
	// the drag and the test passing vacuously. Without ANY previous entry
	// the back-swipe hits the boundary rubber-band and never starts a
	// settle.
	await page.goto('/bookmarks');
	await waitForHydration(page);
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	await installMultiSignalSampler(page, 3000);
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const touch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string
	) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});
	// Phase 1: rightward back-swipe past SWIPE_COMMIT -> commit slide +
	// settle start. The gesture's plan targets `/bookmarks` (a deep page
	// off the bidirectional host); the orchestrator publishes
	// `backMorph: rawDragFraction` so the morph derivation's bm !== null
	// branch tracks the live drag and the settle eases toward
	// `destMorph = atRestMorph(false) = 0` for `/bookmarks`.
	const firstStart = Math.round(width * 0.3);
	const firstEnd = firstStart + 240;
	await touch('touchStart', firstStart, 'touchPressed');
	for (let i = 1; i <= 10; i++) {
		await touch('touchMove', firstStart + Math.round(((firstEnd - firstStart) * i) / 10), 'touchMoved');
	}
	await touch('touchEnd', firstEnd, 'touchReleased');
	// Phase 2 (same CDP session, no async gap): a leftward swipe that
	// re-grabs while the first commit's settle is still running. The new
	// gesture is forward (last tab -> `/search` via `#nextTabTarget`), so
	// the new plan's `targetIsSearch = true`. `#beginGesture` captures
	// `dragMorphAnchor` and `dragFabAnchor` from the settle's morph and
	// FAB scale at the takeover instant; the Header and the FAB layer
	// both consume their respective anchor to keep the visuals
	// continuous across the direction reversal.
	const secondStart = Math.round(width * 0.7);
	const secondEnd = secondStart - 240;
	await touch('touchStart', secondStart, 'touchPressed');
	for (let i = 1; i <= 10; i++) {
		await touch('touchMove', secondStart + Math.round(((secondEnd - secondStart) * i) / 10), 'touchMoved');
	}
	await touch('touchEnd', secondEnd, 'touchReleased');
	await client.detach();
	await waitForMultiSignalDone(page);
	const frames = await readMultiSignalFrames(page);

	const rootJumps = maxFrameJumps(frames, (f) => f.rootLayerTy);
	const burgerJumps = maxFrameJumps(frames, (f) => f.burgerRot);
	const fabJumps = maxFrameJumps(frames, (f) => f.fabScale);
	console.log('opposite-direction re-grab continuity:', {
		rootJumps,
		burgerJumps,
		fabJumps,
		finalPath: new URL(page.url()).pathname
	});

	expect(
		rootJumps.max,
		`rootLayerTy must not snap at the re-grab (max jump ${rootJumps.max.toFixed(2)}px at t=${rootJumps.maxAt}ms)`
	).toBeLessThan(15);
	expect(
		burgerJumps.max,
		`burgerRot must not snap at the re-grab (max jump ${burgerJumps.max.toFixed(2)}deg at t=${burgerJumps.maxAt}ms)`
	).toBeLessThan(35);
	expect(
		fabJumps.max,
		`fabScale must not snap at the re-grab (max jump ${fabJumps.max.toFixed(2)} at t=${fabJumps.maxAt}ms)`
	).toBeLessThan(0.2);
});

// DV21 R8-A F4 continuity guard: a forward-swipe from `/messages/inbox`
// (last tab, has FAB) to `/search` (no FAB) commits and lands on
// `/search`; the new host's `playEnterAnimation` runs. The
// publication's `progress` resets 1 -> 0 at the host swap, so the FAB
// layer's natural `fabScale(progress, fromHasFab, toHasFab)` formula
// would snap from `fabScale(1, true, false) = 0` to `fabScale(0, true,
// false) = 1` in one rAF frame at the enter's first tick. The
// orchestrator stashes the prior commit's terminal FAB scale in
// `#priorTerminalFabScale` (set in `#onExecutorSettle`) and transfers
// it to `#enterFabAnchor` at `playEnterAnimation` (after `#armSettleEase`
// so the clear at the top of the settle arm does not wipe it). The FAB
// layer lerps from `enterFabAnchor.start` (= 0 for this from-only-FAB
// commit) to `enterFabAnchor.dest` (= 0, `/search` has no FAB) across
// `settleMorphFraction`; the lerp is a constant hold and the FAB stays
// hidden across the enter. The audit's BEFORE evidence was a 0 -> 1
// fabScale snap at t=1299ms; the fix reduces the max single-frame jump
// to the regular per-rAF cadence.
test('forward-swipe-to-/search commit-to-enter handoff keeps the FAB scale continuous (R8-A F4)', async ({
	page,
	context
}) => {
	await prepareContext(context);
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	await installMultiSignalSampler(page, 2400);
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.7);
	const endX = startX - Math.round(width * 0.7);
	const touch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string
	) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});
	await touch('touchStart', startX, 'touchPressed');
	for (let i = 1; i <= 14; i++) {
		await touch('touchMove', startX + Math.round(((endX - startX) * i) / 14), 'touchMoved');
	}
	await touch('touchEnd', endX, 'touchReleased');
	await client.detach();
	await waitForMultiSignalDone(page);
	const frames = await readMultiSignalFrames(page);

	const fabJumps = maxFrameJumps(frames, (f) => f.fabScale);
	console.log('commit-to-enter FAB continuity:', {
		fabJumps,
		finalPath: new URL(page.url()).pathname
	});

	expect(page.url(), 'the forward swipe must land on /search').toMatch(/\/search$/);
	expect(
		fabJumps.max,
		`fabScale must not snap at the commit-to-enter handoff (max jump ${fabJumps.max.toFixed(2)} at t=${fabJumps.maxAt}ms)`
	).toBeLessThan(0.2);
});

// DV21 R9-A F1 continuity guard: a boundary-cancel re-grab sampling the FAB
// scale on a first-tab boundary void-swipe whose cancel settle is in flight
// when the user re-grabs forward. The first gesture (rightward back-swipe on
// `/` cold-load) hits the boundary rubber-band (the orchestrator publishes
// `fromPathname === toPathname === '/'` end to end); the FAB layer renders
// the boundary branch `1 - progress * BOUNDARY_RUBBER_BAND_FACTOR` (the
// reduced-amplitude proportional reaction, NOT the natural
// `fabScale(progress, true, true)` icon-handoff half-mapping). Release below
// SWIPE_COMMIT triggers the boundary cancel slide (a settle armed by
// `#armSettleEaseFromGesture(false)`); the publication stays boundary across
// the cancel. Phase 2 (same CDP session, no async gap): a leftward re-grab
// forward to `/activity` (the second tab via `#nextTabTarget`).
// `#beginGesture` captures `#dragFabAnchor` via `#fabScaleAtSettleInstant()`,
// which shares the FAB layer's `computeFabScale` function (R9-A F1) so the
// captured scale mirrors the boundary branch the FAB is rendering at the
// takeover instant. The FAB layer's dragAnchor shift then passes through
// that captured scale and the FAB stays continuous across the
// settle-to-drag boundary. The threshold (max frame-to-frame jump < 0.2)
// guards against any divergence between the helper and the FAB layer's
// branch set (the natural half-mapping at the takeover raw disagrees with
// the boundary proportional value by ~0.48 at a 0.3 raw, so a stale anchor
// scale produces a visible snap on the first new-drag frame).
test('boundary-cancel re-grab into a forward swipe keeps the FAB scale continuous (R9-A F1 boundary)', async ({
	page,
	context
}) => {
	await prepareContext(context);
	// Cold-load `/` so the back-swipe hits the boundary (no previous entry
	// on the first tab; the bidirectional host has nowhere to go back to).
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	await installMultiSignalSampler(page, 3000);
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const touch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string
	) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});
	// Phase 1: rightward back-swipe that reaches ~30% of the viewport then
	// releases below SWIPE_COMMIT. The boundary case always cancels (never
	// commits), so any release triggers the cancel settle. ~30% raw lands
	// the FAB at the boundary proportional value `1 - 0.3 * 0.4 = 0.88`,
	// well clear of the natural half-mapping `1 - 0.3 * 2 = 0.4` so a
	// stale anchor would produce a visible snap.
	const firstStart = Math.round(width * 0.3);
	const firstEnd = firstStart + Math.round(width * 0.3);
	await touch('touchStart', firstStart, 'touchPressed');
	for (let i = 1; i <= 10; i++) {
		await touch('touchMove', firstStart + Math.round(((firstEnd - firstStart) * i) / 10), 'touchMoved');
	}
	await touch('touchEnd', firstEnd, 'touchReleased');
	// Phase 2 (same CDP session, no async gap): a leftward forward swipe
	// that re-grabs while the cancel settle is still running. The new
	// gesture's plan resolves to `/activity` via `#nextTabTarget` (the
	// second tab on the bidirectional host); the publication's from !== to
	// after the re-grab. `#beginGesture` captures `#dragFabAnchor` from
	// `#fabScaleAtSettleInstant()` (boundary branch via the shared
	// `computeFabScale`), and the FAB layer's dragAnchor shift keeps the
	// FAB continuous across the direction reversal.
	const secondStart = Math.round(width * 0.7);
	const secondEnd = secondStart - Math.round(width * 0.6);
	await touch('touchStart', secondStart, 'touchPressed');
	for (let i = 1; i <= 10; i++) {
		await touch('touchMove', secondStart + Math.round(((secondEnd - secondStart) * i) / 10), 'touchMoved');
	}
	await touch('touchEnd', secondEnd, 'touchReleased');
	await client.detach();
	await waitForMultiSignalDone(page);
	const frames = await readMultiSignalFrames(page);

	const fabJumps = maxFrameJumps(frames, (f) => f.fabScale);
	console.log('boundary-cancel re-grab continuity:', {
		fabJumps,
		finalPath: new URL(page.url()).pathname
	});

	expect(page.url(), 'the forward re-grab must land on /activity').toMatch(/\/activity$/);
	expect(
		fabJumps.max,
		`fabScale must not snap at the boundary-cancel re-grab (max jump ${fabJumps.max.toFixed(2)} at t=${fabJumps.maxAt}ms)`
	).toBeLessThan(0.2);
});

// DV21 R9-A F1 continuity guard (sibling): an enter-settle re-grab sampling
// the FAB scale during a forward-enter animation's settle. The first gesture
// (a forward-swipe from `/messages/inbox` to `/search`) commits, the
// navigation lands on `/search`, and the new host's `playEnterAnimation`
// seeds `#enterFabAnchor` from the stashed prior-terminal FAB scale (R8-A
// F4) so the FAB layer lerps `enterAnchor.start` to `enterAnchor.dest`
// across the enter settle. Phase 2 (same CDP session, no async gap, dispatched
// within the enter settle's ~300ms window): a rightward back-swipe on
// `/search` that re-grabs mid-enter. `#beginGesture` captures
// `#dragFabAnchor` via `#fabScaleAtSettleInstant()`, which shares the FAB
// layer's `computeFabScale` function (R9-A F1) so the captured scale mirrors
// the enterAnchor lerp value the FAB is rendering at the takeover instant.
// The FAB layer's dragAnchor shift then passes through that captured scale
// and the FAB stays continuous across the enter-settle-to-drag handoff. The
// threshold (max frame-to-frame jump < 0.2) guards against any divergence
// between the helper and the FAB layer's branch set (the natural
// `fabScale(progress, fromHasFab, toHasFab)` half-mapping disagrees with the
// enterAnchor lerp value mid-enter, so a stale anchor scale produces a
// visible snap on the first new-drag frame).
test('enter-settle re-grab into a back-swipe keeps the FAB scale continuous (R9-A F1 enterAnchor)', async ({
	page,
	context
}) => {
	await prepareContext(context);
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	await installMultiSignalSampler(page, 3000);
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const touch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string
	) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});
	// Phase 1: leftward forward-swipe from `/messages/inbox` to `/search`.
	// The commit slide ends, navigation lands, `playEnterAnimation` seeds
	// `#enterFabAnchor` from the stashed terminal FAB scale (R8-A F4) and
	// arms the enter settle.
	const firstStart = Math.round(width * 0.7);
	const firstEnd = firstStart - Math.round(width * 0.7);
	await touch('touchStart', firstStart, 'touchPressed');
	for (let i = 1; i <= 14; i++) {
		await touch('touchMove', firstStart + Math.round(((firstEnd - firstStart) * i) / 14), 'touchMoved');
	}
	await touch('touchEnd', firstEnd, 'touchReleased');
	// Phase 2 (same CDP session, no async gap): wait for the navigation to
	// land on `/search` so the new host has mounted and `playEnterAnimation`
	// has armed the enter settle, then immediately dispatch a rightward
	// back-swipe that re-grabs mid-enter. The 14-step / ~16ms touchMove
	// sequence spans the first ~220ms of the enter settle's ~300ms window,
	// landing the re-grab inside the enter.
	await page.waitForURL(/\/search$/, { timeout: 4000 });
	const secondStart = Math.round(width * 0.3);
	const secondEnd = secondStart + Math.round(width * 0.6);
	await touch('touchStart', secondStart, 'touchPressed');
	for (let i = 1; i <= 14; i++) {
		await touch('touchMove', secondStart + Math.round(((secondEnd - secondStart) * i) / 14), 'touchMoved');
	}
	await touch('touchEnd', secondEnd, 'touchReleased');
	await client.detach();
	await waitForMultiSignalDone(page);
	const frames = await readMultiSignalFrames(page);

	// Locate the re-grab boundary: the first frame where the orchestrator's
	// published `transitionTarget` flips from the enter's target (`/search`,
	// the destination the enter was animating toward) to the new gesture's
	// target (`/messages/inbox`, the back-swipe destination). `#beginGesture`
	// fires at or just before this flip; sampling a +-300ms window around it
	// captures the settle-to-drag handoff (the FAB layer's dragAnchor shift
	// engaging with the prior settle's enterAnchor lerp value) WITHOUT
	// capturing the natural commit-slide FAB animation later in the
	// back-swipe (a fast back-swipe's commit velocity can produce FAB
	// deltas > 0.2 as the FAB scales in via the natural `(p - 0.5) * 2`
	// formula in the second half - that is the FAB's intended behaviour,
	// not a snap at the re-grab boundary).
	const regabIdx = frames.findIndex(
		(f, i) => i > 0 && f.transitionTarget === '/messages/inbox' && frames[i - 1].transitionTarget !== '/messages/inbox'
	);
	const regabT = regabIdx > 0 ? frames[regabIdx].t : 0;
	const boundaryFrames = frames.filter((f) => Math.abs(f.t - regabT) <= 300);
	const fabJumps = maxFrameJumps(boundaryFrames, (f) => f.fabScale);
	console.log('enter-settle re-grab continuity:', {
		fabJumps,
		regabT,
		finalPath: new URL(page.url()).pathname
	});

	expect(
		fabJumps.max,
		`fabScale must not snap at the enter-settle re-grab (max jump ${fabJumps.max.toFixed(2)} at t=${fabJumps.maxAt}ms)`
	).toBeLessThan(0.2);
});

// DV21 R10-A F1 continuity guard: a forward-swipe from `/messages/inbox`
// (last tab, has FAB) to `/search` (no FAB) commits and lands on `/search`;
// the new host's `playEnterAnimation` runs and seeds `#enterFabAnchor`
// (R8-A F4). Mid-enter, a `goto('/messages/inbox')` arrives via the dev-only
// `__e2eGoto` hook. Because the enter's commit slide puts the executor in
// `phase === 'committing'`, the `onSvelteKitBeforeNavigate` discrete-nav
// branch routes to `#accelerateInFlight` instead of the fresh-slide arm.
// `#accelerateInFlight` calls `#armSettleEase` to accelerate the in-flight
// settle; without the R10 fix the clear at the top of `#armSettleEase`
// wiped `#enterFabAnchor`, and the FAB layer's scale derivation fell to the
// natural `fabScale(progress, ...)` formula. The natural formula disagrees
// with the held enterAnchor lerp value at the accelerate instant (the
// publication's `progress` is mid-enter, where `fabScale(progress, true,
// false)` reads `max(0, 1 - progress*2)`, a nonzero value while the
// enterAnchor lerp holds 0 end to end for the from-only-FAB shape), so the
// FAB snapped in one rAF frame. The R10 fix captures the FAB's in-flight
// value via `#fabScaleAtSettleInstant()` BEFORE the arm clears the anchor
// and re-seeds `#enterFabAnchor = { start: capturedValue, dest:
// prevEnterFabAnchor.dest }` AFTER the arm, mirroring the morph/title
// capture pattern and `playEnterAnimation`'s post-arm re-seed. The audit's
// BEFORE evidence was a 0.44 to 0.58 fabScale snap on this scenario; the
// fix reduces the max single-frame jump to the regular per-rAF cadence.
test('forward-swipe-to-/search enter interrupted by a goto keeps the FAB scale continuous (R10-A F1 accelerateInFlight)', async ({
	page,
	context
}) => {
	await prepareContext(context);
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	await installMultiSignalSampler(page, 3000);
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.7);
	const endX = startX - Math.round(width * 0.7);
	const touch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string
	) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});
	// Phase 1: leftward forward-swipe from `/messages/inbox` to `/search`.
	// The commit slide ends, navigation lands, `playEnterAnimation` seeds
	// `#enterFabAnchor` (R8-A F4) and arms the enter settle. The executor
	// is in `phase === 'committing'` for the enter's slide duration.
	await touch('touchStart', startX, 'touchPressed');
	for (let i = 1; i <= 14; i++) {
		await touch('touchMove', startX + Math.round(((endX - startX) * i) / 14), 'touchMoved');
	}
	await touch('touchEnd', endX, 'touchReleased');
	// Phase 2 (same CDP session, no async gap): wait for the navigation to
	// land on `/search` so the new host has mounted and `playEnterAnimation`
	// has armed the enter settle, then dispatch `__e2eGoto('/messages/inbox')`
	// mid-enter via `Runtime.evaluate`. The goto arrives as a beforeNavigate
	// while the enter's commit is still in flight, so the discrete-nav
	// branch's `phase === 'committing'` test fires and routes to
	// `#accelerateInFlight`. A short delay after the URL land lets the
	// enter slide start before the interrupt; the multi-signal sampler
	// captures the boundary frame.
	await page.waitForURL(/\/search$/, { timeout: 4000 });
	await page.waitForTimeout(60);
	await client.send('Runtime.evaluate', {
		expression: `window.__e2eGoto('/messages/inbox')`,
		awaitPromise: false
	});
	await client.detach();
	await waitForMultiSignalDone(page);
	const frames = await readMultiSignalFrames(page);

	// Locate the accelerate boundary: the first frame where the orchestrator's
	// published `transitionTarget` flips from the enter's target (`/search`,
	// held at rest after the enter slide started) to the accelerated back to
	// `/messages/inbox`. `#accelerateInFlight` fires at or just before this
	// flip; sampling a +-300ms window around it captures the settle-to-settle
	// handoff (the cleared-then-re-seeded enterAnchor engaging with the
	// captured in-flight FAB value) WITHOUT capturing the natural commit-
	// slide FAB animation later in the back-to-`/messages/inbox` slide (the
	// `/search` -> `/messages/inbox` slide animates the FAB in via the natural
	// `(p - 0.5) * 2` formula in the second half, which can produce FAB
	// deltas > 0.2 at high commit velocity - that is the FAB's intended
	// behaviour, not a snap at the accelerate boundary).
	const accelIdx = frames.findIndex(
		(f, i) =>
			i > 0 &&
			f.transitionTarget === '/messages/inbox' &&
			frames[i - 1].transitionTarget !== '/messages/inbox'
	);
	const accelT = accelIdx > 0 ? frames[accelIdx].t : 0;
	const boundaryFrames = frames.filter((f) => Math.abs(f.t - accelT) <= 300);
	const fabJumps = maxFrameJumps(boundaryFrames, (f) => f.fabScale);
	console.log('accelerateInFlight FAB continuity:', {
		fabJumps,
		accelT,
		finalPath: new URL(page.url()).pathname
	});

	expect(
		fabJumps.max,
		`fabScale must not snap at the accelerateInFlight boundary (max jump ${fabJumps.max.toFixed(2)} at t=${fabJumps.maxAt}ms)`
	).toBeLessThan(0.2);
});

// DV21 R12-B F1 continuity guard: a SPA-nav from `/bookmarks` (no FAB) to
// `/messages/inbox` (has FAB); on landing the new host's
// `playEnterAnimation` seeds `#enterFabAnchor` (R8-A F4) with
// `start = dest = 1` (the prior discrete-nav's terminal FAB scale was 1
// for the to-only-FAB `/bookmarks` -> `/messages/inbox` slide, and the
// destination `/messages/inbox`'s resting FAB presence is 1). Phase 2
// (same CDP session, dispatched within the enter settle's ~300ms window):
// a rightward back-swipe re-grab on `/messages/inbox` toward its back-
// target `/bookmarks`. `#beginGesture` captures `#dragFabAnchor` via
// `#fabScaleAtSettleInstant()`, which reads the enterAnchor lerp value
// (1) at the takeover instant; the FAB layer's dragAnchor shift then
// keeps the FAB continuous across the takeover (the shift produces a
// value above the natural `fabScale(progress, true, false) = max(0, 1 -
// progress*2)` for the from-only-FAB `/messages/inbox` -> `/bookmarks`
// shape, because `dragAnchor.scale = 1` minus the natural at the
// takeover raw leaves headroom the natural alone would not reach). The
// re-grab releases below SWIPE_COMMIT (cancel).
// `#armSettleEaseFromGesture(false)` clears `#dragFabAnchor` at the arm;
// without the R12-B F1 fix the FAB layer fell to branch 5 (the natural
// formula), which disagrees with the dragAnchor-shifted value at the
// release raw for this asymmetric-FAB shape. The R12-B F1 fix captures
// the FAB's drag-terminal value via `#fabScaleAtSettleInstant()` BEFORE
// the arm and re-seeds `#enterFabAnchor = { start: capturedValue, dest:
// destFabScale }` AFTER the arm; the FAB layer's branch 3 lerps from the
// captured drag-terminal value to the source's at-rest FAB scale (1,
// `/messages/inbox` has FAB) across `settleMorphFraction`. The audit's
// BEFORE evidence was a 0.796 fabScale value snapped away at the release
// boundary on this scenario.
test('back-swipe from /bookmarks to /messages/inbox re-grab+cancel keeps the FAB continuous at the release handoff (R12-B F1)', async ({
	page,
	context
}) => {
	test.setTimeout(60_000);
	await prepareContext(context);
	// Cold-load `/messages/inbox`, then SPA-nav to `/bookmarks` via the
	// dev-only `__e2eGoto` hook (the same path the drawer link takes).
	// `/bookmarks` host mounts, `playEnterAnimation` seeds `#enterFabAnchor`
	// with `start = dest = 0` (prior commit's terminal FAB was 0 for the
	// from-only-FAB `/messages/inbox` -> `/bookmarks` discrete nav, and
	// `/bookmarks`'s resting FAB presence is 0).
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await openSidebarAndGoto(page, '/bookmarks');
	await page.waitForTimeout(300);

	// Set up the CDP session BEFORE triggering the SPA-nav so the touch
	// dispatch is ready to fire the moment the enter settle starts.
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const touch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string
	) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});

	// Install the sampler BEFORE the second SPA-nav so the sampler
	// captures the entire enter-settle window on `/messages/inbox`.
	await installMultiSignalSampler(page, 5000);
	// Trigger the SPA-nav to `/messages/inbox`. The discrete-nav's slide
	// ends at `/messages/inbox` with terminal FAB = 1 (to-only-FAB shape);
	// `playEnterAnimation` on `/messages/inbox` seeds `#enterFabAnchor`
	// with `start = dest = 1` (R8-A F4) and arms the enter settle.
	await page.evaluate(
		(target) => (window as { __e2eGoto?: (h: string) => Promise<void> }).__e2eGoto!(target),
		'/messages/inbox'
	);
	await page.waitForURL(/\/messages\/inbox$/, { timeout: 4000 });
	// Wait briefly so the re-grab's `#beginGesture` lands inside the
	// enter-settle window (the enter settle's progress is ~0.31 at 50ms
	// into its ~300ms run). At progress ~0.31 the enterAnchor lerponent
	// is 1 (a constant hold for this `{1, 1}` anchor), so the captured
	// `dragAnchor.scale = 1`; the natural at this raw is
	// `max(0, 1 - 0.31*2) = 0.38`, so the dragAnchor shift leaves the FAB
	// at `1 + natural - 0.38 = 0.62 + natural` across the re-grab (a value
	// the post-arm branch 5 could not match without the re-seed).
	await page.waitForTimeout(50);

	// Phase 2 (no async gap): rightward back-swipe re-grab on
	// `/messages/inbox` toward its back-target. `#beginGesture` captures
	// `#dragFabAnchor` via `#fabScaleAtSettleInstant()`, which reads the
	// enterAnchor lerp value (1) at the takeover instant; the FAB layer's
	// dragAnchor shift then keeps the FAB continuous across the takeover.
	// The short drag (40px) stays below SWIPE_COMMIT (60px), so the
	// release arms the cancel settle.
	const secondStart = Math.round(width * 0.3);
	const secondEnd = secondStart + 40;
	await touch('touchStart', secondStart, 'touchPressed');
	for (let i = 1; i <= 10; i++) {
		await touch('touchMove', secondStart + Math.round(((secondEnd - secondStart) * i) / 10), 'touchMoved');
	}
	await touch('touchEnd', secondEnd, 'touchReleased');
	await client.detach();
	await waitForMultiSignalDone(page);
	const frames = await readMultiSignalFrames(page);

	// The re-grab's cancel release is the boundary the R12-B F1 fix
	// targets: `#armSettleEaseFromGesture(false)` clears `#dragFabAnchor`
	// at the arm and (with the fix) re-seeds `#enterFabAnchor` from the
	// captured drag-terminal FAB value. The exact boundary is hard to
	// pinpoint via a single signal flip (the publication's
	// `transitionTarget` flip pattern depends on the re-grab's resolved
	// target on the bidirectional host), so the assertion samples the
	// full post-URL-land window: from the first frame ON `/messages/inbox`
	// (the host swap complete, enter settle running) to the last frame
	// before the sampler ends. The natural FAB animation in this window
	// (enter-settle hold at 1, dragAnchor-shifted values during the
	// re-grab, settle lerp after the cancel release) all stay within the
	// regular per-rAF cadence; a snap at the release boundary would dwarf
	// the surrounding deltas.
	const onMessagesInboxFrames = frames.filter((f) => f.path === '/messages/inbox');
	const fabJumps = maxFrameJumps(onMessagesInboxFrames, (f) => f.fabScale);
	console.log('R12-B F1 release-handoff FAB continuity:', {
		fabJumps,
		frameCount: onMessagesInboxFrames.length,
		firstT: onMessagesInboxFrames[0]?.t ?? 0,
		finalPath: new URL(page.url()).pathname
	});

	expect(
		fabJumps.max,
		`fabScale must not snap at the cancel-release boundary (max jump ${fabJumps.max.toFixed(2)} at t=${fabJumps.maxAt}ms)`
	).toBeLessThan(0.2);
});

// DV21 R14 F1 continuity guard: the discrete-nav arm in
// `onSvelteKitBeforeNavigate` captures both `liveDragMorph` (for the morph
// settle's `startMorph`) and the drag-terminal FAB scale (for the
// `#enterFabAnchor.start` re-seed) BEFORE the state-machine dispatch and
// `#progress = 0` reset. The scenario is the R5 A-F1 / R6 A-F1 shape: a
// forward-enter to `/messages/<id>` (centerTab=2, has FAB) arms an enter
// settle, then a mid-enter rightward back-swipe (240px, saturated) is
// interrupted by `__e2eGoto('/')` mid-drag via the SAME CDP session's
// `Runtime.evaluate` (between `touchMove` and `touchEnd` so the touch /
// goto ordering is deterministic). The discrete-nav arm captures the
// drag-terminal FAB value at the LIVE `#publication.progress` (the drag's
// raw on the drag's plan scale and endpoints); the re-seed lerps from
// that captured value to the destination's at-rest FAB presence across
// `settleMorphFraction`. The FAB layer's branch 3 reads the seeded
// `#enterFabAnchor` and stays continuous across the drag-to-discrete-nav
// handoff. R14 F1: the FAB capture is co-located with `liveDragMorph`
// because the FAB tier is a sibling visual of the morph tier (DV21 §5)
// and must read the same drag-terminal state at the takeover instant.
test('drag-to-discrete-nav handoff keeps the FAB continuous at the interrupt (R14 F1)', async ({
	page,
	context
}) => {
	await prepareContext(context);
	await page.goto('/');
	await waitForHydration(page);
	await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
	await page.waitForURL('/messages/inbox');
	await page.waitForTimeout(200);

	await installMultiSignalSampler(page, 3000);
	// Click a conversation link to trigger the forward-enter to
	// /messages/<id>. The destination's playEnterAnimation arms a settle
	// with startMorph = destMorph = atRestMorph(true) = 1; the FAB
	// seeding follows R8-A F4.
	await page
		.locator('a[href^="/messages/"]:not([href="/messages/inbox"]):not([href="/messages/new"])')
		.first()
		.click();
	await page.waitForURL(/\/messages\/\d+/);
	await page.waitForSelector('.detail-scroll-pane');
	// Wait briefly so the back-swipe lands inside the enter's settle
	// window AND the drag saturates before the discrete nav fires.
	await page.waitForTimeout(60);

	// Single CDP session for both touch events and the goto call so the
	// ordering is preserved (touchMove -> goto -> touchEnd). A Playwright
	// `page.evaluate` between CDP touch events would use a separate IPC
	// channel and could land after the `touchEnd`.
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.3);
	// 320px drag saturates past the to-only-FAB midpoint (raw > 0.5) so
	// the drag's terminal FAB is non-zero (the audit's ~0.34 snap
	// reproduces only when the FAB has entered mid-drag).
	const endX = startX + 320;
	const touch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string
	) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});
	await touch('touchStart', startX, 'touchPressed');
	for (let i = 1; i <= 10; i++) {
		await touch('touchMove', startX + Math.round(((endX - startX) * i) / 10), 'touchMoved');
		// Fire the discrete nav late in the swipe (after the 8th
		// touchMove, when the drag has crossed the to-only-FAB midpoint
		// and the FAB has started entering). At i=8 the drag raw is
		// ~0.65, so the drag's terminal FAB is
		// `max(0, (0.65 - 0.5) * 2) = 0.3` (close to the audit's ~0.34).
		if (i === 8) {
			await client.send('Runtime.evaluate', {
				expression: `window.__e2eGoto('/')`,
				awaitPromise: false
			});
		}
	}
	await touch('touchEnd', endX, 'touchReleased');
	await client.detach();
	await waitForMultiSignalDone(page);
	const frames = await readMultiSignalFrames(page);

	// Locate the discrete-nav boundary: the first frame where the
	// orchestrator's published `transitionTarget` flips from the drag's
	// back-target (`/messages/inbox`) to the discrete nav's destination
	// (`/`). The discrete-nav arm fires at or just before this flip;
	// sampling a +-200ms window around it captures the boundary frame
	// (where the R14 F1 snap would appear) WITHOUT capturing the natural
	// commit-slide FAB animation later in the `/` slide (the
	// `/messages/<id>` -> `/` slide animates the FAB in via the natural
	// `(p - 0.5) * 2` formula in the second half, which can produce FAB
	// deltas > 0.2 at high commit velocity - that is the FAB's intended
	// behaviour, not a snap at the discrete-nav boundary).
	const discreteNavIdx = frames.findIndex(
		(f, i) =>
			i > 0 &&
			f.transitionTarget === '/' &&
			frames[i - 1].transitionTarget !== '/' &&
			frames[i - 1].transitionTarget !== null
	);
	const discreteNavT = discreteNavIdx > 0 ? frames[discreteNavIdx].t : 0;
	const boundaryFrames = frames.filter((f) => Math.abs(f.t - discreteNavT) <= 200);
	const fabJumps = maxFrameJumps(boundaryFrames, (f) => f.fabScale);
	console.log('drag-to-discrete-nav FAB continuity (R14 F1):', {
		fabJumps,
		discreteNavT,
		discreteNavIdx,
		frameCount: frames.length,
		firstT: frames[0]?.t ?? 0,
		finalPath: new URL(page.url()).pathname
	});

	expect(
		fabJumps.max,
		`fabScale must not snap at the drag-to-discrete-nav handoff (max jump ${fabJumps.max.toFixed(2)} at t=${fabJumps.maxAt}ms)`
	).toBeLessThan(0.2);
});

// DV21 R22-A F1 continuity guard (shape T,T,F): a back-swipe on `/activity`
// (tab source) whose drag's target is the temporal-previous `/profile/settings`
// (deep), interrupted mid-swipe by `goto('/messages/inbox')` (tab
// destination). The source and the discrete-nav destination share tab-ness
// (both T), but the drag's target is F. The helper
// `#dragMorphAtSettleTakeover` classifies the DRAG's shape from its
// parameters; sourcing them from the discrete-nav destination
// (outgoing=true, incoming=true, isTabToTab, dragMorphWasStatic) returns
// `atRestMorph(true) = 1` = `sourceRest` = `destMorph`, the settle-arm
// condition evaluates false, the settle is SKIPPED, and the morph snaps
// from the drag's terminal (1 - raw) to the at-rest (1) at the
// drag-to-discrete-nav handoff. Sourcing from the drag's target
// (outgoing=true, incoming=false) returns `dragMorphAtAnchorOrRaw(true,
// raw) = 1 - raw`; liveDragMorph differs from sourceRest (1) and destMorph
// (1), the settle fires, and the morph eases across the slide. The drag
// is fired via the SAME CDP session's `Runtime.evaluate` between the 6th
// touchMove and the touchEnd so the touch / goto ordering is deterministic.
test('drag-to-discrete-nav handoff: shape (T,T,F) tab source, tab discrete-nav dest, deep drag target (R22-A F1)', async ({
	page,
	context
}) => {
	await prepareContext(context);
	await page.goto('/profile/settings');
	await waitForHydration(page);
	// SPA-nav to `/activity` so the temporal-previous is `/profile/settings`
	// (deep), making the backward gesture target a deep route from a tab
	// source (the shape R22-A names).
	await page.evaluate(() => window.__e2eGoto('/activity'));
	await page.waitForURL('/activity');
	await page.waitForTimeout(300);

	await installMultiSignalSampler(page, 3000);
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.3);
	const endX = startX + 240;
	const touch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string
	) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});
	await touch('touchStart', startX, 'touchPressed');
	for (let i = 1; i <= 10; i++) {
		await touch('touchMove', startX + Math.round(((endX - startX) * i) / 10), 'touchMoved');
		if (i === 6) {
			await client.send('Runtime.evaluate', {
				expression: `window.__e2eGoto('/messages/inbox')`,
				awaitPromise: false
			});
		}
	}
	await touch('touchEnd', endX, 'touchReleased');
	await client.detach();
	await waitForMultiSignalDone(page);
	const frames = await readMultiSignalFrames(page);

	const rootJumps = maxFrameJumps(frames, (f) => f.rootLayerTy);
	const burgerJumps = maxFrameJumps(frames, (f) => f.burgerRot);
	console.log('R22-A F1 (T,T,F) continuity:', {
		rootJumps,
		burgerJumps,
		finalPath: new URL(page.url()).pathname
	});

	expect(
		rootJumps.max,
		`rootLayerTy must not snap at the drag-to-discrete-nav handoff (max jump ${rootJumps.max.toFixed(2)}px at t=${rootJumps.maxAt}ms)`
	).toBeLessThan(15);
	expect(
		burgerJumps.max,
		`burgerRot must not snap at the drag-to-discrete-nav handoff (max jump ${burgerJumps.max.toFixed(2)}deg at t=${burgerJumps.maxAt}ms)`
	).toBeLessThan(35);
});

// DV21 R22-A F1 continuity guard (shape F,F,T): a back-swipe on
// `/profile/settings` (deep source) whose drag's target is the
// temporal-previous `/` (tab), interrupted mid-swipe by `goto('/bookmarks')`
// (deep destination). The source and the discrete-nav destination share
// tab-ness (both F), but the drag's target is T. Sourcing the helper's
// parameters from the discrete-nav destination (outgoing=false,
// incoming=false, isDeepToDeep) returns the hardcoded 0 = `sourceRest` =
// `destMorph`, the settle-arm condition evaluates false, the settle is
// SKIPPED, and the morph snaps from the drag's terminal (raw) to the
// at-rest (0). Sourcing from the drag's target (outgoing=false,
// incoming=true) returns `dragMorphAtAnchorOrRaw(false, raw) = raw`;
// liveDragMorph differs from sourceRest (0) and destMorph (0), the settle
// fires, and the morph eases across the slide.
test('drag-to-discrete-nav handoff: shape (F,F,T) deep source, deep discrete-nav dest, tab drag target (R22-A F1)', async ({
	page,
	context
}) => {
	await prepareContext(context);
	await page.goto('/');
	await waitForHydration(page);
	// SPA-nav to `/profile/settings` so the temporal-previous is `/` (tab),
	// making the backward gesture target a tab route from a deep source.
	await page.evaluate(() => window.__e2eGoto('/profile/settings'));
	await page.waitForURL('/profile/settings');
	await page.waitForTimeout(300);

	await installMultiSignalSampler(page, 3000);
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.3);
	const endX = startX + 240;
	const touch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string
	) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});
	await touch('touchStart', startX, 'touchPressed');
	for (let i = 1; i <= 10; i++) {
		await touch('touchMove', startX + Math.round(((endX - startX) * i) / 10), 'touchMoved');
		if (i === 6) {
			await client.send('Runtime.evaluate', {
				expression: `window.__e2eGoto('/bookmarks')`,
				awaitPromise: false
			});
		}
	}
	await touch('touchEnd', endX, 'touchReleased');
	await client.detach();
	await waitForMultiSignalDone(page);
	const frames = await readMultiSignalFrames(page);

	const rootJumps = maxFrameJumps(frames, (f) => f.rootLayerTy);
	const deepJumps = maxFrameJumps(frames, (f) => f.deepLayerTy);
	const burgerJumps = maxFrameJumps(frames, (f) => f.burgerRot);
	console.log('R22-A F1 (F,F,T) continuity:', {
		rootJumps,
		deepJumps,
		burgerJumps,
		finalPath: new URL(page.url()).pathname
	});

	expect(
		rootJumps.max,
		`rootLayerTy must not snap at the drag-to-discrete-nav handoff (max jump ${rootJumps.max.toFixed(2)}px at t=${rootJumps.maxAt}ms)`
	).toBeLessThan(15);
	// R23-A: the deep title layer must also stay continuous. The layer-tier
	// `tabsIn` decoupling keeps the layer guard `!(tabsOut || tabsIn) = false`
	// during the settle (the drag's target was a tab, so the OR yields true),
	// so the morph-based `translateY(morph*100%)` formula drives the title
	// layer end-to-end and converges to `0%` as morph eases to `destMorph = 0`
	// (the deep discrete-nav dest's at-rest). Without the decoupling the layer
	// would freeze at `0%` while morph is mid-ease (the audit's ~14.66px snap
	// applied to both layers).
	expect(
		deepJumps.max,
		`deepLayerTy must not snap at the drag-to-discrete-nav handoff (max jump ${deepJumps.max.toFixed(2)}px at t=${deepJumps.maxAt}ms)`
	).toBeLessThan(15);
	expect(
		burgerJumps.max,
		`burgerRot must not snap at the drag-to-discrete-nav handoff (max jump ${burgerJumps.max.toFixed(2)}deg at t=${burgerJumps.maxAt}ms)`
	).toBeLessThan(35);
});

// DV21 R22-A F1 continuity guard (shape F,T,F): a back-swipe on `/bookmarks`
// (deep source) whose drag's target is the temporal-previous
// `/profile/settings` (deep), interrupted mid-swipe by
// `goto('/messages/inbox')` (tab destination). The source and the drag's
// target share tab-ness (both F, a deep-to-deep drag whose morph
// hardcodes 0), but the discrete-nav destination is T. Sourcing the
// helper's parameters from the discrete-nav destination (outgoing=false,
// incoming=true) returns `dragMorphAtAnchorOrRaw(false, raw) = raw`,
// which DISAGREES with the drag's actual terminal morph (0, hardcoded by
// the deep-to-deep drag branch); the settle's `startMorph = raw` then
// snaps from the drag's terminal (0) to raw at the handoff. Sourcing from
// the drag's target (outgoing=false, incoming=false, isDeepToDeep)
// returns 0, matching the drag's actual terminal morph; the settle
// continues from 0 and eases toward destMorph = 1 (the tab destination's
// at-rest) across the slide.
test('drag-to-discrete-nav handoff: shape (F,T,F) deep source, tab discrete-nav dest, deep drag target (R22-A F1)', async ({
	page,
	context
}) => {
	await prepareContext(context);
	await page.goto('/profile/settings');
	await waitForHydration(page);
	// SPA-nav to `/bookmarks` so the temporal-previous is
	// `/profile/settings` (deep), making the backward gesture target a deep
	// route from a deep source (a deep-to-deep drag).
	await page.evaluate(() => window.__e2eGoto('/bookmarks'));
	await page.waitForURL('/bookmarks');
	await page.waitForTimeout(300);

	await installMultiSignalSampler(page, 3000);
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.3);
	const endX = startX + 240;
	const touch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string
	) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});
	await touch('touchStart', startX, 'touchPressed');
	for (let i = 1; i <= 10; i++) {
		await touch('touchMove', startX + Math.round(((endX - startX) * i) / 10), 'touchMoved');
		if (i === 6) {
			await client.send('Runtime.evaluate', {
				expression: `window.__e2eGoto('/messages/inbox')`,
				awaitPromise: false
			});
		}
	}
	await touch('touchEnd', endX, 'touchReleased');
	await client.detach();
	await waitForMultiSignalDone(page);
	const frames = await readMultiSignalFrames(page);

	const rootJumps = maxFrameJumps(frames, (f) => f.rootLayerTy);
	const burgerJumps = maxFrameJumps(frames, (f) => f.burgerRot);
	console.log('R22-A F1 (F,T,F) continuity:', {
		rootJumps,
		burgerJumps,
		finalPath: new URL(page.url()).pathname
	});

	expect(
		rootJumps.max,
		`rootLayerTy must not snap at the drag-to-discrete-nav handoff (max jump ${rootJumps.max.toFixed(2)}px at t=${rootJumps.maxAt}ms)`
	).toBeLessThan(15);
	expect(
		burgerJumps.max,
		`burgerRot must not snap at the drag-to-discrete-nav handoff (max jump ${burgerJumps.max.toFixed(2)}deg at t=${burgerJumps.maxAt}ms)`
	).toBeLessThan(35);
});

// DV21 R23-B F1 continuity guard: a forward-swipe-to-`/search` from
// `/messages/inbox` (the last tab, isSearch=false) whose drag target is
// `/search` (targetIsSearch=true, the panel slides in via `searchProgress
// = bm`), interrupted mid-swipe by `__e2eGoto('/activity')` (a non-search
// tab-root discrete nav, the shape the orchestrator's discrete-nav arm
// intercepts). At the interrupt the orchestrator's
// `#searchProgressAtSettleInstant` captures the live `bm` (e.g. 0.30) and
// re-seeds `#searchAnchor = { start: bm, dest: 0 }` AFTER the discrete-nav
// arm. The Header's `searchProgress` derivation's settle-anchor branch
// lerps `start` -> `dest` across `settleMorphFraction`, keeping the header
// track continuous with the drag's terminal value. Without the anchor the
// at-rest / gesture switch collapses `searchProgress` from `bm` to 0 in
// one rAF frame at the boundary (targetIsSearch flips to false when
// `transitionTarget` clears, so the `targetIsSearch ? trackMorph : 0` arm
// returns 0), snapping the header track by `bm * viewport-width` (~118px at
// raw=0.30 on a 393px viewport).
test('drag-to-discrete-nav handoff with a non-search goto keeps the header search track continuous (R23-B F1)', async ({
	page,
	context
}) => {
	await prepareContext(context);
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	await installMultiSignalSampler(page, 3000);
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.7);
	const endX = startX - Math.round(width * 0.7);
	const touch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string
	) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});
	await touch('touchStart', startX, 'touchPressed');
	for (let i = 1; i <= 14; i++) {
		await touch('touchMove', startX + Math.round(((endX - startX) * i) / 14), 'touchMoved');
		if (i === 6) {
			await client.send('Runtime.evaluate', {
				expression: `window.__e2eGoto('/activity')`,
				awaitPromise: false
			});
		}
	}
	await touch('touchEnd', endX, 'touchReleased');
	await client.detach();
	await waitForMultiSignalDone(page);
	const frames = await readMultiSignalFrames(page);

	const hdrTrackJumps = maxFrameJumps(frames, (f) => f.hdrTrackTx);
	console.log('R23-B F1 hdrTrackTx continuity:', {
		hdrTrackJumps,
		finalPath: new URL(page.url()).pathname
	});

	expect(
		page.url(),
		'the interrupted drag must land on the discrete-nav destination'
	).toMatch(/\/activity$/);
	expect(
		hdrTrackJumps.max,
		`hdrTrackTx must not snap at the drag-to-discrete-nav handoff (max jump ${hdrTrackJumps.max.toFixed(2)}px at t=${hdrTrackJumps.maxAt}ms)`
	).toBeLessThan(30);
});

// DV21 R23-B F2 continuity guard: a saturated forward-swipe from
// `/messages/inbox` (isSearch=false) to `/search` (targetIsSearch=true) that
// commits. At raw=1 (the commit slide's terminal) `#onExecutorSettle`
// stashes `#priorTerminalSearchProgress = 1` (the panel slid fully in).
// SvelteKit's host swap lands on `/search`, `playEnterAnimation` runs on
// the new search-mode host, and the search anchor is seeded
// `{ start: 1, dest: 1 }` AFTER the enter arm so the Header's
// `searchProgress` derivation's settle-anchor branch holds the panel fully
// in across the enter settle. Without the anchor the natural
// `searchProgress = 1 - trackMorph = bm` curve the enter slide publishes
// resets 1 -> 0 (host swap zeroes `#progress`) then runs 0 -> 1 across the
// enter slide, snapping the panel fully out (~viewport-width, ~393px on a 393px
// viewport) and then re-animating it in (R23-B F2: ~393px of wasted motion
// across the enter).
test('forward-swipe-to-/search commit-to-enter handoff keeps the header search track continuous (R23-B F2)', async ({
	page,
	context
}) => {
	await prepareContext(context);
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	await installMultiSignalSampler(page, 2800);
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.7);
	const endX = startX - Math.round(width * 0.7);
	const touch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string
	) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});
	await touch('touchStart', startX, 'touchPressed');
	for (let i = 1; i <= 14; i++) {
		await touch('touchMove', startX + Math.round(((endX - startX) * i) / 14), 'touchMoved');
	}
	await touch('touchEnd', endX, 'touchReleased');
	await client.detach();
	await waitForMultiSignalDone(page);
	const frames = await readMultiSignalFrames(page);

	const hdrTrackJumps = maxFrameJumps(frames, (f) => f.hdrTrackTx);
	console.log('R23-B F2 hdrTrackTx continuity:', {
		hdrTrackJumps,
		finalPath: new URL(page.url()).pathname
	});

	expect(page.url(), 'the forward swipe must land on /search').toMatch(/\/search$/);
	expect(
		hdrTrackJumps.max,
		`hdrTrackTx must not snap at the commit-to-enter handoff (max jump ${hdrTrackJumps.max.toFixed(2)}px at t=${hdrTrackJumps.maxAt}ms)`
	).toBeLessThan(30);
});

// DV21 R24-A continuity guard: a saturated forward-swipe from `/messages/inbox`
// to `/search` commits and lands on `/search`, `playEnterAnimation` seeds
// `#searchAnchor = { start: 1, dest: 1 }` (R23-B F2) and arms the enter
// settle. While the enter slide is still in flight a same-session CDP
// `__e2eGoto('/messages/inbox')` arrives; the discrete-nav branch's
// `phase === 'committing'` test routes to `#accelerateInFlight`, which re-arms
// the settle ease and (R24-A) captures the in-flight search-axis position via
// `#searchProgressAtSettleInstant` BEFORE the arm clears `#searchAnchor`, then
// re-seeds the anchor AFTER the arm so the Header's `searchProgress`
// derivation's settle-anchor branch holds the panel position across the
// accelerated re-arm. Without the re-seed the post-arm `#searchAnchor = null`
// would hand the search axis to the natural `searchProgress = bm` formula,
// whose `bm` value at the accelerate instant disagrees with the held-at-1
// value the Header was rendering, snapping the header search track partially
// out at the boundary (~304px snap on a 393px viewport, R24-A defect). The
// boundary window is the pre-flip frames plus the accelerate flip
// frame itself (a one-sided slice, not a symmetric +-ms window like
// the R10-A F1 FAB guard): the back-to-`/messages/inbox` slide
// animates the search track out via the natural `searchProgress = 1 -
// bm` formula across the whole ~300ms slide (a large intended
// slide-out, eased so most motion is early), so the no-snap assertion
// excludes post-flip frames to keep that natural slide-out out of the
// metric.
test('forward-swipe-to-/search enter interrupted by a goto keeps the header search track continuous (R24-A accelerateInFlight)', async ({
	page,
	context
}) => {
	await prepareContext(context);
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	await installMultiSignalSampler(page, 3000);
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.7);
	const endX = startX - Math.round(width * 0.7);
	const touch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string
	) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});
	// Phase 1: leftward forward-swipe from `/messages/inbox` to `/search`.
	// The commit slide ends, navigation lands on `/search`, and the new
	// search-mode host's `playEnterAnimation` seeds `#searchAnchor` (R23-B
	// F2) and arms the enter settle. The executor is in
	// `phase === 'committing'` for the enter's slide duration.
	await touch('touchStart', startX, 'touchPressed');
	for (let i = 1; i <= 14; i++) {
		await touch('touchMove', startX + Math.round(((endX - startX) * i) / 14), 'touchMoved');
	}
	await touch('touchEnd', endX, 'touchReleased');
	// Phase 2 (same CDP session, no async gap): wait for the navigation to
	// land on `/search` so the new host has mounted and
	// `playEnterAnimation` has armed the enter settle, then dispatch
	// `__e2eGoto('/messages/inbox')` mid-enter via `Runtime.evaluate`. The
	// goto arrives as a beforeNavigate while the enter's commit is still in
	// flight, so the discrete-nav branch's `phase === 'committing'` test
	// fires and routes to `#accelerateInFlight`. A short delay after the
	// URL land lets the enter slide start before the interrupt; the
	// multi-signal sampler captures the boundary frame.
	await page.waitForURL(/\/search$/, { timeout: 4000 });
	await page.waitForTimeout(60);
	await client.send('Runtime.evaluate', {
		expression: `window.__e2eGoto('/messages/inbox')`,
		awaitPromise: false
	});
	await client.detach();
	await waitForMultiSignalDone(page);
	const frames = await readMultiSignalFrames(page);

	// Locate the accelerate boundary: the first frame where the
	// orchestrator's published `transitionTarget` flips from the enter's
	// target (`/search`, held at rest after the enter slide started) to the
	// accelerated back to `/messages/inbox`. `#accelerateInFlight` fires at
	// or just before this flip. The no-snap window is the pre-flip frames
	// plus the flip frame itself: the back-to-`/messages/inbox` slide
	// animates the search track out via the natural
	// `searchProgress = 1 - bm` formula across the slide's ~300ms duration
	// (the panel's intended full-range slide-out, eased to ~35-40px per
	// rAF at the start), so including post-flip frames in the window would
	// mix the natural slide motion into the no-snap assertion. The
	// accelerate boundary snap this guard watches for is a one-frame
	// discontinuity in the pre-flip range, where the cleared-then-re-seeded
	// `#searchAnchor` engages with the captured in-flight search-axis
	// value.
	const accelIdx = frames.findIndex(
		(f, i) =>
			i > 0 &&
			f.transitionTarget === '/messages/inbox' &&
			frames[i - 1].transitionTarget !== '/messages/inbox'
	);
	const accelT = accelIdx > 0 ? frames[accelIdx].t : 0;
	const boundaryFrames = accelIdx > 0 ? frames.slice(0, accelIdx + 1) : frames;
	const hdrTrackJumps = maxFrameJumps(boundaryFrames, (f) => f.hdrTrackTx);
	console.log('R24-A accelerateInFlight hdrTrackTx continuity:', {
		hdrTrackJumps,
		accelT,
		finalPath: new URL(page.url()).pathname
	});

	expect(page.url(), 'the interrupted enter must land back on /messages/inbox').toMatch(
		/\/messages\/inbox$/
	);
	expect(
		hdrTrackJumps.max,
		`hdrTrackTx must not snap at the accelerateInFlight boundary (max jump ${hdrTrackJumps.max.toFixed(2)}px at t=${hdrTrackJumps.maxAt}ms)`
	).toBeLessThan(30);
});

// DV21 R26-A continuity guard: a saturated forward-swipe from
// `/messages/inbox` to `/search` commits and lands on `/search`; the new
// search-mode host's `playEnterAnimation` seeds `#searchAnchor = { start:
// 1, dest: 1 }` (R23-B F2 hold) and arms the enter settle. While that
// settle is in flight a same-session CDP touch dispatch starts a new
// rightward back-swipe on the `/search` host (a re-grab whose target is
// the temporal-previous `/messages/inbox`). `#beginGesture` captures
// `#dragSearchAnchor = { search: <in-flight settle-anchor lerp value at
// the takeover>, raw: startProgress }` BEFORE `#cancelAllAnimationEases`
// clears the settle and `#searchAnchor`. The Header's `searchProgress`
// drag-anchor branch shifts the natural gesture formula through
// `(anchor.raw, anchor.search)` so the search track stays continuous with
// the prior settle across the takeover (DV21 §5). The R26-A defect
// (~238px snap on a 393px viewport) is the search-axis sibling of the
// morph axis's R8-A F1 re-grab snap and the FAB axis's R8-A F3 re-grab
// snap: without a drag-owned anchor the cleared `#searchAnchor` hands the
// search axis to the natural `bm`-driven gesture formula at the
// takeover, which disagrees with the held settle lerp. The boundary
// window is the pre-flip frames plus the re-grab flip frame (the
// `transitionTarget` flip from `/search` to `/messages/inbox` as the
// re-grab takes over; `dragging` flips true and the live `backMorph`
// value switches from the enter settle's slide fraction to the drag's
// raw fraction). `backMorph` is a non-null number throughout the enter
// settle on `/search`, never null here.
test('re-grab during a search-settle keeps the header search track continuous (R26-A)', async ({
	page,
	context
}) => {
	await prepareContext(context);
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	await installMultiSignalSampler(page, 3000);
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const touch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string
	) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});
	// Phase 1: saturated leftward forward-swipe from `/messages/inbox` to
	// `/search`. The commit slide ends, navigation lands on `/search`, and
	// the new search-mode host's `playEnterAnimation` seeds `#searchAnchor`
	// (R23-B F2) and arms the enter settle (Title crossfade easing the
	// search-axis hold at 1 across the enter slide).
	const startX = Math.round(width * 0.7);
	const endX = startX - Math.round(width * 0.7);
	await touch('touchStart', startX, 'touchPressed');
	for (let i = 1; i <= 14; i++) {
		await touch('touchMove', startX + Math.round(((endX - startX) * i) / 14), 'touchMoved');
	}
	await touch('touchEnd', endX, 'touchReleased');
	// Phase 2 (same CDP session): wait for the URL to land on `/search`
	// and the enter settle to be in flight (the post-commit Title
	// crossfade), then a rightward back-swipe begins the re-grab.
	// `#beginGesture` captures `#dragSearchAnchor` from the in-flight
	// searchAnchor lerp value via `#searchProgressAtSettleInstant` BEFORE
	// `#cancelAllAnimationEases` clears the settle. The re-grab is a
	// back-swipe on `/search` (a NavPipelineHost deep page) toward its
	// temporal-previous (`/messages/inbox`); the orchestrator publishes
	// live `backMorph` so the drag-anchor branch's bm !== null shift
	// sub-case fires.
	await page.waitForURL(/\/search$/, { timeout: 4000 });
	await page.waitForTimeout(30);
	const secondStart = Math.round(width * 0.3);
	const secondEnd = secondStart + 240;
	await touch('touchStart', secondStart, 'touchPressed');
	for (let i = 1; i <= 10; i++) {
		await touch(
			'touchMove',
			secondStart + Math.round(((secondEnd - secondStart) * i) / 10),
			'touchMoved'
		);
	}
	await touch('touchEnd', secondEnd, 'touchReleased');
	await client.detach();
	await waitForMultiSignalDone(page);
	const frames = await readMultiSignalFrames(page);

	// Locate the re-grab boundary: the first frame after Phase 1's URL
	// land on `/search` where the orchestrator's `transitionTarget`
	// flips from `/search` (held by the enter settle) to the back-swipe's
	// `/messages/inbox` target. The no-snap window is the pre-flip frames
	// plus the flip frame itself (the boundary at which the drag-anchor
	// branch holds the panel continuous with the prior settle). The
	// post-flip natural slide motion and the subsequent drag-to-settle
	// handoff run after the flip and are excluded from the assertion
	// window (they are separate motion sources, not the R26-A boundary).
	const landIdx = frames.findIndex(
		(f, i) => i > 0 && f.path === '/search' && frames[i - 1].path !== '/search'
	);
	const searchBoundaryStart = landIdx > 0 ? landIdx : 0;
	const reGrabIdx = frames.findIndex(
		(f, i) =>
			i > searchBoundaryStart &&
			f.transitionTarget === '/messages/inbox' &&
			frames[i - 1].transitionTarget !== '/messages/inbox'
	);
	const reGrabT = reGrabIdx > 0 ? frames[reGrabIdx].t : 0;
	const boundaryFrames = reGrabIdx > 0 ? frames.slice(searchBoundaryStart, reGrabIdx + 1) : frames;
	const hdrTrackJumps = maxFrameJumps(boundaryFrames, (f) => f.hdrTrackTx);
	console.log('R26-A re-grab hdrTrackTx continuity:', {
		hdrTrackJumps,
		reGrabT,
		landIdx,
		finalPath: new URL(page.url()).pathname
	});

	expect(
		hdrTrackJumps.max,
		`hdrTrackTx must not snap at the re-grab boundary (max jump ${hdrTrackJumps.max.toFixed(2)}px at t=${hdrTrackJumps.maxAt}ms)`
	).toBeLessThan(30);
});

// DV21 R28 continuity guard: a saturated forward-swipe from `/messages/inbox`
// to `/search` commits and lands on `/search`; the new search-mode host's
// `playEnterAnimation` seeds `#searchAnchor = { start: 1, dest: 1 }` (R23-B F2
// hold) and arms the enter settle. A rightward back-swipe begins the re-grab;
// `#beginGesture` captures `#dragSearchAnchor = { search: 1, raw:
// startProgress }` BEFORE `#cancelAllAnimationEases` clears the settle. The
// re-grab's drag publishes live `backMorph` so the Header's `searchProgress`
// drag-anchor branch (branch 3) fires, returning the shift formula
// `anchor.search + natural(bm) - natural(anchor.raw)` (the search-axis
// position the drag was rendering). Mid-drag (BEFORE the re-grab's touchEnd)
// an external `__e2eGoto('/activity')` dispatches a discrete-nav interrupt
// that re-enters `onSvelteKitBeforeNavigate`. The discrete-nav arm at L2803
// captures `liveDragSearchProgress = #searchProgressAtSettleInstant()` and
// re-seeds `#searchAnchor = { start: captured, dest: 0 }` (dest 0 because
// `/activity` is not `/search`). The R28 defect (~162-219px snap on a 393px
// viewport) is the helper omitting the drag-anchor branch: it returns the
// gesture value `1 - bm` while the Header was rendering branch 3's shift
// `anchor.search + natural(bm) - natural(anchor.raw)`, disagreeing by
// `anchor.raw * viewport-width` px (the captured `start` seeds the new
// settle, so the disagreement snaps the search track at the takeover). The
// fix mirrors the Header's branch 3 shift formula in the helper, so the
// captured `start` agrees with the rendering. The boundary window is the
// pre-flip frames plus the transitionTarget-flip frame (the re-grab's live
// `/messages/inbox` target flips to `/activity` at the discrete-nav dispatch).
test('mid-re-grab discrete-nav interrupt keeps the header search track continuous (R28)', async ({
	page,
	context
}) => {
	await prepareContext(context);
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	await installMultiSignalSampler(page, 3500);
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const touch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string
	) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y: 400, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});
	// Phase 1: saturated leftward forward-swipe from `/messages/inbox` to
	// `/search`. The commit slide ends, navigation lands on `/search`, and the
	// new search-mode host's `playEnterAnimation` seeds `#searchAnchor` (R23-B
	// F2 hold at 1) and arms the enter settle.
	const startX = Math.round(width * 0.7);
	const endX = startX - Math.round(width * 0.7);
	await touch('touchStart', startX, 'touchPressed');
	for (let i = 1; i <= 14; i++) {
		await touch('touchMove', startX + Math.round(((endX - startX) * i) / 14), 'touchMoved');
	}
	await touch('touchEnd', endX, 'touchReleased');
	// Phase 2 (same CDP session): wait for the URL to land on `/search` and
	// the enter settle to be in flight, then start a rightward back-swipe (the
	// re-grab). `#beginGesture` captures `#dragSearchAnchor = { search: 1, raw:
	// startProgress }` from the in-flight settle-anchor lerp (held at 1 by
	// `playEnterAnimation`'s R23-B F2 seed) BEFORE `#cancelAllAnimationEases`
	// clears the settle. Mid-drag (no touchEnd yet) the live `backMorph` is
	// non-null so the Header's branch 3 shift sub-case fires.
	await page.waitForURL(/\/search$/, { timeout: 4000 });
	await page.waitForTimeout(30);
	const secondStart = Math.round(width * 0.3);
	const secondEnd = secondStart + 240;
	await touch('touchStart', secondStart, 'touchPressed');
	for (let i = 1; i <= 10; i++) {
		await touch(
			'touchMove',
			secondStart + Math.round(((secondEnd - secondStart) * i) / 10),
			'touchMoved'
		);
	}
	// Phase 3: mid-re-grab (touch still pressed, no touchEnd), dispatch the
	// discrete-nav interrupt via `__e2eGoto('/activity')`. The beforeNavigate
	// hook re-enters `onSvelteKitBeforeNavigate`; the discrete-nav arm at L2803
	// captures `liveDragSearchProgress = #searchProgressAtSettleInstant()`
	// BEFORE the state-machine dispatch and `#progress = 0` reset, then
	// re-seeds `#searchAnchor = { start: captured, dest: 0 }` for the new
	// `/activity` settle. The helper's drag-anchor branch returns the same
	// shift value the Header's branch 3 was rendering at the capture instant,
	// so the new settle's `start` agrees with the rendering and the search
	// track stays continuous at the takeover.
	await client.send('Runtime.evaluate', {
		expression: `window.__e2eGoto('/activity')`,
		awaitPromise: false
	});
	await client.detach();
	await waitForMultiSignalDone(page);
	const frames = await readMultiSignalFrames(page);

	// Locate the discrete-nav boundary: the first frame where the
	// orchestrator's published `transitionTarget` flips from the re-grab's
	// `/messages/inbox` target to the goto's `/activity` target. The no-snap
	// window starts at the re-grab's own transitionTarget flip (when the
	// re-grab's drag publication begins) and ends at the interrupt flip + 1
	// frame, excluding Phase 1's forward-swipe slide and focusing the
	// assertion on the re-grab drag motion plus the discrete-nav takeover.
	// The post-flip `/search` -> `/activity` settle animates the search track
	// out via the natural settle-anchor lerp from the captured `start` to 0
	// across the settle's duration (the panel's intended full-range slide-out,
	// eased to ~35-40px per rAF at the start), so the +1 frame after the flip
	// is the latest the boundary snap can register; later frames mix the
	// natural settle motion into the no-snap assertion. The boundary snap
	// this guard watches for is a one-frame discontinuity at the flip, where
	// the captured `start` would engage with the gesture value instead of the
	// drag-anchor shift if the helper's drag-anchor branch were missing.
	const landIdx = frames.findIndex(
		(f, i) => i > 0 && f.path === '/search' && frames[i - 1].path !== '/search'
	);
	const searchBoundaryStart = landIdx > 0 ? landIdx : 0;
	const reGrabIdx = frames.findIndex(
		(f, i) =>
			i > searchBoundaryStart &&
			f.transitionTarget === '/messages/inbox' &&
			frames[i - 1].transitionTarget !== '/messages/inbox'
	);
	const reGrabBoundaryStart = reGrabIdx > 0 ? reGrabIdx : searchBoundaryStart;
	const interruptIdx = frames.findIndex(
		(f, i) =>
			i > reGrabBoundaryStart &&
			f.transitionTarget === '/activity' &&
			frames[i - 1].transitionTarget !== '/activity'
	);
	const interruptT = interruptIdx > 0 ? frames[interruptIdx].t : 0;
	const boundaryFrames =
		interruptIdx > 0 ? frames.slice(reGrabBoundaryStart, interruptIdx + 2) : frames;
	const hdrTrackJumps = maxFrameJumps(boundaryFrames, (f) => f.hdrTrackTx);
	console.log('R28 mid-re-grab discrete-nav hdrTrackTx continuity:', {
		hdrTrackJumps,
		interruptT,
		reGrabIdx,
		finalPath: new URL(page.url()).pathname
	});

	expect(page.url(), 'the interrupted re-grab must land on /activity').toMatch(/\/activity$/);
	expect(
		hdrTrackJumps.max,
		`hdrTrackTx must not snap at the mid-re-grab discrete-nav boundary (max jump ${hdrTrackJumps.max.toFixed(2)}px at t=${hdrTrackJumps.maxAt}ms)`
	).toBeLessThan(30);
});
