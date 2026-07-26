import { test, expect } from '@playwright/test';
import {
	prepareContext,
	waitForHydration,
	swipeBack,
	collectConsole,
	installMultiSignalSampler,
	waitForMultiSignalDone,
	readMultiSignalFrames,
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
					// reactively (via `fabScale(progress, fromHasFab,
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
		// resting FAB). The FAB scales 1->0 across the enter via the reactive
		// `fabScale(progress, fromHasFab=true, toHasFab=false)` half-mapping
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
		// history.back, ~200ms later). A `waitForFunction` poll can
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
		// variant spaces them 40ms apart (a 520ms total drag -> sub-1
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
		// The threshold allows one rAF of regular progress (~12px / ~22deg
		// at this viewport's header height); a snap lands ~26px / ~82deg.
		expect(
			rootJumps.max,
			`rootLayerTy must not snap at release (max jump ${rootJumps.max.toFixed(2)}px at t=${rootJumps.maxAt}ms)`
		).toBeLessThan(15);
		expect(
			burgerJumps.max,
			`burgerRot must not snap at release (max jump ${burgerJumps.max.toFixed(2)}deg at t=${burgerJumps.maxAt}ms)`
		).toBeLessThan(35);
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
