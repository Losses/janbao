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

interface HeldDrag {
	release: () => Promise<void>;
}

/**
 * Hold a touch drag (no release) toward `direction` ('back' = rightward/previous,
 * 'forward' = leftward/next) via CDP - the only path detectSwipe recognises. The
 * drag is held past SWIPE_COMMIT so the preview is mid-gesture; call release()
 * to finish. Used to inspect what each swipe surface previews BEFORE commit.
 */
async function holdDrag(
	page: import('@playwright/test').Page,
	direction: 'back' | 'forward'
): Promise<HeldDrag> {
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const startX = direction === 'back' ? Math.round(width * 0.3) : Math.round(width * 0.7);
	const heldX = direction === 'back' ? startX + 130 : startX - 130;
	const dispatch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, state: string) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y: 500, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});
	await dispatch('touchStart', startX, 'touchPressed');
	await dispatch('touchMove', heldX, 'touchMoved');
	await page.waitForTimeout(180);
	return {
		release: async () => {
			await dispatch('touchEnd', heldX, 'touchReleased');
			await client.detach();
		}
	};
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

	// --- Scope guards: the back chip must appear ONLY for a tab back-swipe whose
	// real target is a deep page. It must NEVER appear on a GesturePageLayout deep
	// page (a thread), nor on a forward swipe, nor when the back target is a tab
	// root. These catch the exact regressions the user reported (a chip on a
	// thread back-swipe; a gray block on an Activity forward-swipe).

	test('thread back-swipe never shows the back chip (it is GesturePageLayout, not the tab pager)', async ({ page }) => {
		await threadPathOn(page);
		const held = await holdDrag(page, 'back');
		const has = await page.evaluate(() => ({
			backChip: !!document.querySelector('.back-chip-overlay'),
			loadingChip: !!document.querySelector('.loading-overlay')
		}));
		await held.release();
		// The thread renders GesturePageLayout, not MobileTabPager, so the tab
		// pager's back chip is structurally impossible here.
		expect(has.backChip, 'the MobileTabPager back chip must never appear on a thread').toBe(false);
		// Discussions cache is warm (we came from `/`), so GesturePageLayout's own
		// loading chip must not show either - the real discussions preview does.
		expect(has.loadingChip, 'no loading chip on a warm-cache thread back-swipe').toBe(false);
	});

	test('Activity forward-swipe reveals the Messages tab, never the back chip', async ({ page }) => {
		await page.goto('/');
		await waitForHydration(page);
		await swipeForward(page); // `/` → `/activity`
		await page.waitForFunction(() => location.pathname === '/activity', null, { timeout: 8000 });
		await page.waitForTimeout(300);

		const held = await holdDrag(page, 'forward');
		const probe = await page.evaluate(() => {
			const messages = document.querySelector('[data-tab-panel="messages"]');
			const rect = messages?.getBoundingClientRect();
			return {
				backChip: !!document.querySelector('.back-chip-overlay'),
				messagesLeft: rect ? Math.round(rect.left) : null,
				vw: window.innerWidth
			};
		});
		await held.release();
		// Forward swipe (deltaX < 0) can never trigger the back chip (gated on
		// deltaX > 0). The Messages panel must slide into view from the right.
		expect(probe.backChip, 'the back chip must never appear on a forward swipe').toBe(false);
		expect(
			probe.messagesLeft ?? 9999,
			'the Messages tab panel must slide into view on a forward swipe'
		).toBeLessThan(probe.vw);
	});

	test('tab back-swipe to a tab root reveals the tab, never the back chip', async ({ page }) => {
		await page.goto('/');
		await waitForHydration(page);
		await swipeForward(page); // `/` → `/activity` (history-prev is `/`, a tab root)
		await page.waitForFunction(() => location.pathname === '/activity', null, { timeout: 8000 });
		await page.waitForTimeout(300);

		const held = await holdDrag(page, 'back');
		const probe = await page.evaluate(() => {
			const discussions = document.querySelector('[data-tab-panel="discussions"]');
			const rect = discussions?.getBoundingClientRect();
			return {
				backChip: !!document.querySelector('.back-chip-overlay'),
				discRight: rect ? Math.round(rect.right) : null
			};
		});
		await held.release();
		// The back target is a tab root, so this is a normal tab<->tab swipe: no
		// chip, and the Discussions tab panel slides in from the left.
		expect(probe.backChip, 'no back chip when the back target is a tab root').toBe(false);
		expect(probe.discRight ?? -9999, 'the Discussions tab panel must slide into view').toBeGreaterThan(0);
	});

	// --- Cold-cache back-preview. A user who opens / refreshes a thread directly
	// has never visited the discussions list, so its cache is cold. The thread's
	// back-preview (leftSnippet reads listCache.discussions) must still render the
	// real list, not a bare loading chip. Pre-fix it was a chip (the cache is only
	// seeded on the `/` route); the fix seeds it from the always-available layout
	// load. This is the "讨论内页右拉直接拉出 chip" symptom.
	test('deep-linked thread back-preview shows the discussions list, not a cold-cache chip', async ({ page }) => {
		// Grab a thread href, then FULL-RELOAD to it: a fresh document resets the
		// list-cache singleton, reproducing the cold-cache state of a direct open.
		await page.goto('/');
		await waitForHydration(page);
		const threadHref = await page.locator('a[href^="/discussion/"]').first().getAttribute('href');
		if (!threadHref) throw new Error('no discussion link on the homepage');
		await page.goto(threadHref); // full reload → cold list cache
		await waitForHydration(page);
		await page.waitForTimeout(400);

		// The thread's left back-preview (GesturePageLayout's left section) must
		// render the real discussions list, not a cold-cache LoadingChip.
		const restPreview = await page.evaluate(() => {
			const center = document.querySelector('.detail-scroll-pane');
			const track = center?.parentElement;
			const left = track
				? [...track.children].find((s) => !s.classList.contains('detail-scroll-pane'))
				: null;
			return {
				hasLoadingChip: !!left?.querySelector('.loading-chip'),
				discussionLinks: left?.querySelectorAll('a[href^="/discussion/"]').length ?? 0
			};
		});
		expect(restPreview.hasLoadingChip, 'a cold-cache back-preview must not be a bare loading chip').toBe(false);
		expect(restPreview.discussionLinks, 'the discussions list must render in the back-preview').toBeGreaterThan(0);

		// During the back-swipe itself: the cache is seeded, so leftNeedsLoading is
		// false and no loading overlay appears.
		const held = await holdDrag(page, 'back');
		const during = await page.evaluate(() => ({
			loadingOverlay: !!document.querySelector('.loading-overlay')
		}));
		await held.release();
		expect(during.loadingOverlay, 'no loading overlay during a seeded-cache back-swipe').toBe(false);
	});
});
