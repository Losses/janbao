import { test, expect } from '@playwright/test';
import {
	prepareContext,
	swipeForward,
	swipeBack,
	waitForHydration,
	clickDiscussion
} from './helpers';

/**
 * Regression for the "thread → swipe into a tab → swipe back → landed on the
 * list, not the thread" bug. The flow is generic: ANY GesturePageLayout deep
 * page that forward-swipes into a tab must, on the subsequent back-swipe,
 * return to that deep page. A discussion thread is used as the concrete deep
 * page (the reported repro); the fix itself is route-agnostic (see
 * backSwipeShouldPopHistory in history-nav.ts), so this also covers a profile /
 * bookmarks / search page forwarded into a tab.
 *
 * Two invariants are asserted, each of which the bug broke:
 *  1. A forward swipe ADVANCES - it must push the tab onto history, not REPLACE
 *     the originating page (the cold-cache loading-chip path used replaceState,
 *     erasing the thread from history entirely).
 *  2. A back-swipe on a tab reached from a deep page returns to that page via
 *     history.back(), instead of the tab pager's spatial "previous tab" switch
 *     (which pushed the discussions root and stranded the thread).
 *
 * Driven through real CDP touch swipes (detectSwipe rejects pointerType mouse).
 * Pre-fix: fails at invariant 1 (thread not preserved) or 2 (lands on `/`).
 */

async function threadPathOn(page: import('@playwright/test').Page): Promise<string> {
	await page.goto('/');
	await waitForHydration(page);
	await clickDiscussion(page, 0);
	await page.waitForFunction(
		() => location.pathname.startsWith('/discussion/'),
		null,
		{ timeout: 8000 }
	);
	// Let the thread's GesturePageLayout + detectSwipe bind before gesturing.
	await page.waitForTimeout(300);
	return new URL(page.url()).pathname;
}

test.describe('forward-swipe into a tab then back-swipe', () => {
	test.beforeEach(async ({ context }) => {
		await prepareContext(context);
	});

	test('CALIBRATION: a thread is reachable from the discussions list', async ({ page }) => {
		const threadPath = await threadPathOn(page);
		expect(threadPath.startsWith('/discussion/')).toBe(true);
	});

	test('back-swipe returns to the originating deep page, not the discussions list', async ({ page }) => {
		const threadPath = await threadPathOn(page);

		// Forward swipe (R→L): thread → its right-neighbour tab (Activity).
		await swipeForward(page);
		await page.waitForFunction(() => location.pathname === '/activity', null, { timeout: 8000 });
		await page.waitForTimeout(200);

		// Invariant 1: the originating thread must still be in history (forward
		// swipe pushed the tab; it did not overwrite the thread).
		const threadPreserved = await page.evaluate((tp) => {
			const entries = navigation.entries();
			return entries.some((e) => {
				if (!e.url) return false;
				try {
					return new URL(e.url).pathname === tp;
				} catch {
					return false;
				}
			});
		}, threadPath);
		expect(threadPreserved, 'forward swipe must push the tab, not replace the originating page').toBe(true);

		// Back swipe (L→R): must return to the thread, not the discussions root.
		await swipeBack(page);
		await page.waitForTimeout(400);
		const landed = new URL(page.url()).pathname;
		expect(landed, 'back-swipe from a tab reached via a deep page must return to that page').toBe(threadPath);
	});

	test('back-swipe preview matches the history-previous page, not the spatial previous tab', async ({ page }) => {
		const threadPath = await threadPathOn(page);
		await swipeForward(page);
		await page.waitForFunction(() => location.pathname === '/activity', null, { timeout: 8000 });
		await page.waitForTimeout(300);

		// The back target is the thread (history-prev), which is NOT the spatial
		// left-neighbour tab (Discussions). Its DOM is unmounted, so the preview
		// cannot be the live Discussions panel - dragging the spatial track would
		// slide that wrong tab into view, contradicting the landing.
		const trackAt = async () =>
			page.evaluate(() => {
				const track = document.querySelector('.mobile-tab-pager-viewport > div') as HTMLElement | null;
				if (!track) return null;
				try {
					return new DOMMatrix(getComputedStyle(track).transform).m41;
				} catch {
					return null;
				}
			});
		const restTrackX = await trackAt();

		// Hold a back-drag (no release) past SWIPE_COMMIT.
		const client = await page.context().newCDPSession(page);
		await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
		const width = page.viewportSize()?.width ?? 393;
		const startX = Math.round(width * 0.3);
		const heldX = startX + 130;
		const dispatch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, state: string) =>
			client.send('Input.dispatchTouchEvent', {
				type,
				// CDP needs each touch point's state; Playwright's TouchPoint omits it.
				touchPoints: [{ state, x, y: 500, id: 1 }] as unknown as never,
				modifiers: 0,
				timestamp: 0
			});
		await dispatch('touchStart', startX, 'touchPressed');
		await dispatch('touchMove', heldX, 'touchMoved');
		await page.waitForTimeout(180);

		const [dragTrackX, backOverlayPresent] = await page.evaluate(() => [
			(() => {
				const track = document.querySelector('.mobile-tab-pager-viewport > div') as HTMLElement | null;
				if (!track) return null;
				try {
					return new DOMMatrix(getComputedStyle(track).transform).m41;
				} catch {
					return null;
				}
			})(),
			!!document.querySelector('.back-chip-overlay')
		]);

		// The spatial track must NOT translate rightward (which would reveal the
		// Discussions tab): dragTrackX stays at its rest position.
		expect(
			(restTrackX === null || dragTrackX === null) ? true : dragTrackX <= restTrackX + 5,
			'back-swipe must not slide the (wrong) Discussions tab panel into view when the real target is a deep page'
		).toBe(true);
		// The shared unmounted-target back overlay (LoadingChip) shows instead - the
		// same affordance GesturePageLayout uses for an unmounted back target.
		expect(backOverlayPresent, 'the back-chip overlay must show during the drag').toBe(true);

		// Release: lands on the thread (single source of truth - real history).
		await dispatch('touchEnd', heldX, 'touchReleased');
		await client.detach();
		await page.waitForTimeout(400);
		expect(new URL(page.url()).pathname).toBe(threadPath);
	});
});
