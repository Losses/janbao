import { test, expect } from '@playwright/test';
import {
	prepareContext,
	waitForHydration,
	swipeBack,
	collectConsole
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
	 *  ramp (no backward jumps) has zero reversals. A coverProgress
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
					// `pager.coverProgress` reactively and writes the
					// atom's `transform: scale(...)`. The e2e asserts
					// the scale transitions during the commit slide so
					// the FAB tracks the slide (rather than freezing
					// at a stale value).
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
		// publishes `coverProgress` each commit rAF tick so the FAB
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
		// coverProgress discontinuity at the drag-to-commit boundary
		// (raw fraction vs threshold-absorbed progress) produces at
		// least one FAB-scale reversal.
		expect(
			capture.fabReversals,
			`FAB scale must ramp monotonically (reversals=${capture.fabReversals}; ` +
				`coverProgress must be continuous across the drag-to-commit boundary)`
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
		// live-drag raw so coverProgress does not jump backward).
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
		// resting FAB). The FAB scales 1->0 across the enter via the layer's
		// family-swap ease, which holds at the destination scale (0) until the
		// transition lands (coverProgress resets), so the FAB never spikes back
		// up after easing out. Sample the FAB scale across the enter and assert
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
		// The enter animation is ~200ms; the tab-click must begin within
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

	test('tab-click during gesture commit starts from current position (no backward jump)', async ({
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
		// rAF window (~200ms). This exercises the R16/R17 fix: the
		// tab-exit should start from the executor's current progress
		// (mid-commit), not from 0 (which would snap the track backward).
		await swipeBack(page);
		await page.click('[data-tab-nav][href="/messages/inbox"]');
		await page.waitForURL('**/messages/inbox', { timeout: 5000 });

		// Assert no backward jump (reversals = 0 across the interrupt).
		const samples = (await page.evaluate(() => (window as any).__commitInterruptSamples)) as number[];
		expect(samples.length, 'sampler should have captured frames').toBeGreaterThan(3);
		let reversals = 0;
		for (let i = 2; i < samples.length; i++) {
			const prevDelta = samples[i - 1] - samples[i - 2];
			const currDelta = samples[i] - samples[i - 1];
			if (prevDelta * currDelta < 0) reversals++;
		}
		expect(reversals, `track should not reverse during interrupt (samples=${samples.slice(0, 10).join(',')})`).toBe(0);
	});

	// The gesture-during-tab-click-commit interrupt is not separately
	// e2e'd here: the gesture must catch the tab-click's ~200ms slide
	// slide, a race too tight to be reliable under varying dev-server
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
});
