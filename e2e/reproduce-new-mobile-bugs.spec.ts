import { test, expect } from '@playwright/test';
import {
	prepareContext,
	waitForHydration,
	captureFabTransition,
	capturePagerSwitch,
	captureGplTrackPresence,
	captureEnterAnimation,
	captureGplBackSwipe,
	clickDiscussion,
	swipeBack
} from './helpers';

// Verification specs for the compose-as-module-child fix. The compose routes
// /post/discussion and /messages/new mount a GesturePageLayout (like threads
// and conversations), are config-classified onto their module tab, and the
// DualColumnLayout tab-swipe yields to the GPL on any GPL route. These tests
// lock the fixed behaviour in.

async function tabbarVisible(page: import('@playwright/test').Page): Promise<boolean> {
	return page.evaluate(() => {
		// In root mode the tab-bar layer sits at translateY(0); in deep mode it is
		// translated to -100% (hidden). That transform is the ground truth for
		// whether the header shows the tab bar.
		const rootLayer = document.querySelector(
			'header div.absolute.inset-0.flex.items-center.justify-center'
		) as HTMLElement | null;
		return rootLayer ? !rootLayer.style.transform.includes('-100%') : false;
	});
}

test.describe('Compose-as-module-child fix (FAB, Messages, chip)', () => {
	test.beforeEach(async ({ context }) => {
		await prepareContext(context);
	});

	// ---- Bug 1/2 fixed: compose routes play the push animation ---------------
	// /post/discussion now mounts a GesturePageLayout (centre = the compose form,
	// left = the discussions list), so entering it from '/' slides the list out
	// and the form in, exactly like entering a thread.
	test('Bug 1 fixed: / -> /post/discussion mounts a GPL and plays the push animation', async ({
		page
	}) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.waitForTimeout(300);
		const presence = await captureGplTrackPresence(page, async () => {
			await page.locator('[data-testid="fab"]').click();
			await page.waitForURL('/post/discussion');
		});
		expect(presence.trackEverMounted, 'a GesturePageLayout track mounted on the compose route').toBe(
			true
		);
	});

	test('Bug 1 push magnitude: / -> /post/discussion track slides (per-frame)', async ({ page }) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.waitForTimeout(300);
		const cap = await captureEnterAnimation(page, async () => {
			await page.locator('[data-testid="fab"]').click();
			await page.waitForURL('/post/discussion');
		});
		expect(cap.animated, 'the compose form slid in (push animation played)').toBe(true);
	});

	test('Bug 2 fixed: /messages/inbox -> /messages/new mounts a GPL and plays the push animation', async ({
		page
	}) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(300);
		const presence = await captureGplTrackPresence(page, async () => {
			await page.locator('[data-testid="fab"]').click();
			await page.waitForURL('/messages/new');
		});
		expect(
			presence.trackEverMounted,
			'a GesturePageLayout track mounted on the messages compose route'
		).toBe(true);
	});

	// ---- Bug 4 fixed: both compose routes are root-mode (tab bar), consistent
	test('Bug 4 fixed: /post/discussion and /messages/new are both root-mode (tab bar)', async ({
		page
	}) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.locator('[data-testid="fab"]').click();
		await page.waitForURL('/post/discussion');
		await page.waitForTimeout(400);
		const postVisible = await tabbarVisible(page);
		expect(postVisible, '/post/discussion shows the tab bar (root mode)').toBe(true);

		await page.goto('/');
		await waitForHydration(page);
		await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(300);
		await page.locator('[data-testid="fab"]').click();
		await page.waitForURL('/messages/new');
		await page.waitForTimeout(400);
		const msgVisible = await tabbarVisible(page);
		expect(msgVisible, '/messages/new shows the tab bar (root mode, consistent)').toBe(true);
	});

	// ---- Bug 1c fixed: back-swipe on a compose route returns to the source list
	test('Bug 1c fixed: back-swipe on /post/discussion returns to / (GPL owns the gesture)', async ({
		page
	}) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.locator('[data-testid="fab"]').click();
		await page.waitForURL('/post/discussion');
		await page.waitForTimeout(400);
		await swipeBack(page);
		await page.waitForURL('/', { timeout: 5000 });
		expect(new URL(page.url()).pathname, 'back-swipe returned to the discussions list').toBe('/');
	});

	// ---- Bug 3 fixed: DualColumnLayout tab-swipe is disabled on compose routes
	// /messages/new mounts a GPL, so isGesturePageLayoutRoute is true and the
	// DualColumnLayout tab-swipe is disabled: a right-drag does not shift the
	// content. The GPL owns the gesture, so the back-swipe returns to the source
	// inbox (/messages/inbox), not the spatial-prev tab /activity.
	test('Bug 3 fixed: right-drag on /messages/new yields to the GPL and returns to /messages/inbox', async ({
		page
	}) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(300);
		await page.locator('[data-testid="fab"]').click();
		await page.waitForURL('/messages/new');
		await page.waitForTimeout(400);

		await page.evaluate(() => {
			const frames: { t: number; tx: number }[] = [];
			(window as unknown as { __swipe: { frames: typeof frames; done: boolean } }).__swipe = {
				frames,
				done: false
			};
			const start = performance.now();
			const tick = (): void => {
				const el = document.querySelector('.dual-column-layout-content') as HTMLElement | null;
				let tx = 0;
				if (el) {
					const m = getComputedStyle(el).transform.match(/matrix\(([^)]+)\)/);
					if (m) tx = Number(m[1].split(',')[4]);
				}
				frames.push({ t: Math.round(performance.now() - start), tx: Math.round(tx) });
				if (performance.now() - start > 1200) {
					(window as unknown as { __swipe: { done: boolean } }).__swipe.done = true;
					return;
				}
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
		const client = await page.context().newCDPSession(page);
		await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
		const y = 400;
		const disp = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, state: string) =>
			client.send('Input.dispatchTouchEvent', {
				type,
				touchPoints: [{ state, x, y, id: 1 }] as unknown as never,
				modifiers: 0,
				timestamp: 0
			});
		await disp('touchStart', 120, 'touchPressed');
		for (let x = 135; x <= 260; x += 15) await disp('touchMove', x, 'touchMoved');
		await page.waitForTimeout(200);
		await disp('touchEnd', 260, 'touchReleased');
		await page.waitForFunction(
			() => (window as unknown as { __swipe?: { done: boolean } }).__swipe?.done === true,
			{ timeout: 5000 }
		);
		const frames = await page.evaluate(
			() => (window as unknown as { __swipe: { frames: { tx: number }[] } }).__swipe.frames
		);
		const maxTx = Math.max(...frames.map((f) => f.tx));
		expect(maxTx, 'content did not shift (DualColumnLayout tab-swipe disabled on the GPL route)').toBeLessThan(
			20
		);
		expect(
			new URL(page.url()).pathname,
			'GPL back-swipe returned to the source inbox (not the spatial-prev tab /activity)'
		).toBe('/messages/inbox');
	});

	// ---- Bug 3 edge: chip on a compose back-target renders the arrow + 返回
	// fallback. Stack [/ -> /post/discussion -> /bookmarks]; back-swipe on
	// /bookmarks toward the compose route enters chip mode (compose has no
	// preview panel), and the chip renders the back-arrow + back-label fallback.
	test('Bug 3 edge: chip toward a compose back-target renders the arrow + back fallback', async ({
		page
	}) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.locator('[data-testid="fab"]').click();
		await page.waitForURL('/post/discussion');
		await page.waitForTimeout(300);
		await page.evaluate(
			(t) =>
				(window as unknown as { __e2eGoto?: (h: string) => Promise<void> }).__e2eGoto!(t),
			'/bookmarks'
		);
		await page.waitForFunction(() => location.pathname === '/bookmarks');
		await page.waitForTimeout(400);
		const snap = await captureGplBackSwipe(page);
		expect(snap.chipMode, 'chip mode activates (compose has no preview panel)').toBe(true);
		expect(
			snap.chipText && snap.chipText.trim().length > 0,
			'the chip rendered the back-label fallback content'
		).toBe(true);
	});

	// ---- Reference + regression guards --------------------------------------
	test('reference: / -> Discussion thread plays the push animation', async ({ page }) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.waitForTimeout(300);
		const cap = await captureEnterAnimation(page, async () => {
			await clickDiscussion(page, 0);
			await page.waitForURL(/\/discussion\//);
		});
		expect(cap.animated, 'thread enter slides the track').toBe(true);
	});

	test('FAB atom guard: / -> /post/discussion eases the atom scale 1 -> 0', async ({ page }) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.waitForTimeout(300);
		const cap = await captureFabTransition(page, async () => {
			await page.locator('[data-testid="fab"]').click();
			await page.waitForURL('/post/discussion');
		});
		// DV20 5b2 Phase 1: the discrete list -> compose family swap is eased by
		// the FAB layer's rAF family-swap ease (the inline scale advances each
		// frame), not the `.fab-transition` CSS class (armed only for a GPL
		// `pendingNav` exit slide). The behavioural guard is `animated`
		// (scale delta > 0.1); the class-active `transitionFrames` signal no
		// longer fires for this discrete swap.
		expect(cap.animated, 'FAB atom scale eased across the swap').toBe(true);
	});

	test('pager switch guard: / -> Messages tab slides the pager', async ({ page }) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.waitForTimeout(300);
		const cap = await capturePagerSwitch(page, async () => {
			await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
			await page.waitForURL('/messages/inbox');
		});
		expect(cap.animated, 'pager track slid to the Messages tab').toBe(true);
		expect(cap.firstPanel).toBe('discussions');
		expect(cap.lastPanel).toBe('messages');
	});
});
