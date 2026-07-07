import { test, expect } from '@playwright/test';
import {
	prepareContext,
	waitForHydration,
	swipeBack,
	collectConsole
} from './helpers';

/**
 * DV20 Cycle 5b1 — pilot-route back-swipe gesture regression.
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
					w.__pilotSwipe!.frames.push({
						t: Math.round(performance.now() - start),
						m41: Math.round(m41)
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
		return {
			frames: f,
			reversals,
			firstM41: movingM41s[0] ?? null,
			lastM41: m41s[m41s.length - 1] ?? null,
			minM41: m41s.length ? Math.min(...m41s) : 0,
			maxM41: m41s.length ? Math.max(...m41s) : 0,
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
	});
});
