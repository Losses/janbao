import { test, expect } from '@playwright/test';
import {
	prepareContext,
	waitForHydration,
	captureFabTransition,
	capturePagerSwitch,
	captureGplBackSwipe,
	captureGplTrackPresence,
	captureEnterAnimation,
	clickDiscussion
} from './helpers';

// Reproduction specs for the three newly reported mobile bugs (homepage FAB,
// Messages tab switch, forced chip mode). Each test documents the ACTUAL
// observed behaviour under per-frame sampling: where a real defect exists the
// assertion encodes the defect (and is meant to flip once fixed); where the
// animation path actually works the assertion is a regression guard.

test.describe('New mobile bugs: FAB, Messages tab, forced chip mode', () => {
	test.beforeEach(async ({ context }) => {
		await prepareContext(context);
	});

	// ---- Bug 1: "顶栏为空" (empty top bar) on compose routes -----------------
	// /post/discussion and /messages/new are compose routes. They are neither
	// tab roots nor entries in deep-header-config, so in deep mode the Header's
	// title layer renders an empty title (the back arrow shows, the title does
	// not). Both routes share the same omission. The assertions below encode the
	// defect: the rendered deep-title text is empty. (Flip to expect a real
	// title once deep-header-config gains compose entries.)
	test('Bug 1a: /post/discussion header title is empty (compose route missing deep-header-config)', async ({
		page
	}) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.locator('[data-testid="fab"]').click();
		await page.waitForURL('/post/discussion');
		await page.waitForTimeout(400);

		// resolveHeaderMode('/post/discussion') === 'deep' (no tab match), so the
		// deep-title layer (layerDownStyle) is the visible one; its span text is
		// the header title. deep-header-config has no '/post/discussion' entry and
		// the page sets no headerTitle, so it is empty.
		const deepTitle = await page.evaluate(() => {
			const header = document.querySelector('header');
			const spans = Array.from(header?.querySelectorAll('span') ?? []);
			const title = spans
				.map((s) => s.textContent?.trim() ?? '')
				.filter((t) => t.length > 0)
				.find((t) => !['动态', '站内信', '讨论'].includes(t));
			return title ?? '';
		});
		expect(deepTitle, 'compose route should have a header title but renders empty').toBe('');
	});

	test('Bug 1b: /messages/new header title is empty (same compose-route gap)', async ({ page }) => {
		await page.goto('/');
		await waitForHydration(page);
		// Reach the messages compose route via the inbox FAB.
		await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(300);
		const messagesFab = page.locator('[data-testid="fab"]');
		const hasFab = await messagesFab.count();
		if (hasFab > 0) {
			await messagesFab.click();
			await page.waitForURL('/messages/new');
			await page.waitForTimeout(400);
			const deepTitle = await page.evaluate(() => {
				const spans = Array.from(document.querySelectorAll('header span') ?? []);
				const title = spans
					.map((s) => s.textContent?.trim() ?? '')
					.filter((t) => t.length > 0)
					.find((t) => !['动态', '站内信', '讨论'].includes(t));
				return title ?? '';
			});
			expect(deepTitle, '/messages/new shares the empty-title compose gap').toBe('');
		}
	});

	// ---- Bug 1: "左滑手势不生效" (back-swipe dead) on compose routes ---------
	// Compose routes render DualColumnLayout (not GesturePageLayout).
	// DualColumnLayout's detectSwipe is disabled wherever the swipe baseline is
	// < 0 (no tab association); /post/discussion's baseline is -1, so a horizontal
	// drag inside the page is ignored. The OS edge-back gesture is the only way
	// back. This test documents that gap: an in-app back-swipe does nothing.
	test('Bug 1c: in-app back-swipe on /post/discussion is a no-op (no GesturePageLayout)', async ({
		page
	}) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.locator('[data-testid="fab"]').click();
		await page.waitForURL('/post/discussion');
		await page.waitForTimeout(400);

		const client = await page.context().newCDPSession(page);
		await client.send('Emulation.setTouchEmulationEnabled', {
			enabled: true,
			maxTouchPoints: 5
		});
		const y = 400;
		const disp = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, state: string) =>
			client.send('Input.dispatchTouchEvent', {
				type,
				touchPoints: [{ state, x, y, id: 1 }] as unknown as never,
				modifiers: 0,
				timestamp: 0
			});
		await disp('touchStart', 120, 'touchPressed');
		for (let x = 135; x <= 300; x += 15) await disp('touchMove', x, 'touchMoved');
		await page.waitForTimeout(150);
		await disp('touchEnd', 300, 'touchReleased');
		await page.waitForTimeout(400);

		expect(
			new URL(page.url()).pathname,
			'in-app back-swipe on a compose route must not navigate (no gesture layer)'
		).toBe('/post/discussion');
		await client.detach();
	});

	// ---- Bug 1: no push animation (old page pushed away) --------------------
	// The reported "no transition animation" is the page-level push animation
	// (the source page slides out, the destination slides in), NOT the FAB atom.
	// Threads have it: GesturePageLayout's shouldAnimateEnter (line 233) starts
	// the track at the left list panel (snapIndex 0) and animates it to the
	// centre thread panel, so the list is pushed out left and the thread enters
	// from the right. Compose routes (/post/discussion) render DualColumnLayout
	// with NO GesturePageLayout, so there is no track to slide and the compose
	// form just swaps in. captureEnterAnimation samples the GPL track; on a
	// compose route there is no .detail-scroll-pane track at all, so it records
	// no motion.

	test('Bug 1d (reference): / -> Discussion thread plays the push animation', async ({ page }) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.waitForTimeout(300);
		const cap = await captureEnterAnimation(page, async () => {
			await clickDiscussion(page, 0);
			await page.waitForURL(/\/discussion\//);
		});
		// The track translated ~one panel width: the list pushed out, the thread
		// slid in. This is the animation the compose route is missing.
		expect(cap.animated, 'thread enter slides the track (push animation)').toBe(true);
		expect(cap.sampleCount, 'a GPL track was mounted and sampled').toBeGreaterThan(0);
	});

	test('Bug 1e (defect): / -> /post/discussion has NO push animation (no GesturePageLayout)', async ({
		page
	}) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.waitForTimeout(300);
		const cap = await captureGplTrackPresence(page, async () => {
			await page.locator('[data-testid="fab"]').click();
			await page.waitForURL('/post/discussion');
		});
		expect(
			cap.trackFrames,
			'no GesturePageLayout track ever mounted on the compose route -> no push animation'
		).toBe(0);
		expect(cap.sampleCount, 'sampler ran across the nav window').toBeGreaterThan(0);
	});

	// Separately, the FAB ATOM's own scale-out is a different animation and does
	// play (the layer latches discreteNavInFlight on the list->compose family
	// swap). Kept as a narrow regression guard for the atom, not the page push.
	test('FAB atom regression guard: / -> /post/discussion eases the atom scale 1 -> 0', async ({
		page
	}) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.waitForTimeout(300);
		const cap = await captureFabTransition(page, async () => {
			await page.locator('[data-testid="fab"]').click();
			await page.waitForURL('/post/discussion');
		});
		expect(cap.sampleCount, 'sampler ran').toBeGreaterThan(0);
		expect(cap.animated, 'FAB atom scale eased across the swap, not snapped').toBe(true);
		expect(cap.transitionFrames, 'fab-transition class was active during the ease').toBeGreaterThan(
			0
		);
	});

	// ---- Bug 2: messages inbox -> FAB -> /messages/new has no push animation -
	// The reported "站内信 Tab 没有切换动画" is the SAME root cause as Bug 1: the
	// messages compose route /messages/new renders MessageCompose (DualColumnLayout
	// only), NOT a GesturePageLayout, so the inbox list is not pushed out and the
	// compose form does not slide in. (The tab-pager switch / -> /messages/inbox
	// itself DOES animate; that is not the reported bug. Kept as a guard below.)
	test('Bug 2 (defect): /messages/inbox -> FAB -> /messages/new has NO push animation', async ({
		page
	}) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(300);
		const cap = await captureGplTrackPresence(page, async () => {
			await page.locator('[data-testid="fab"]').click();
			await page.waitForURL('/messages/new');
		});
		expect(
			cap.trackFrames,
			'no GesturePageLayout track ever mounted on /messages/new -> no push animation'
		).toBe(0);
		expect(cap.sampleCount, 'sampler ran across the nav window').toBeGreaterThan(0);
	});

	test('pager switch guard: / -> Messages tab slides the pager (NOT the reported bug)', async ({
		page
	}) => {
		await page.goto('/');
		await waitForHydration(page);
		await page.waitForTimeout(300);
		const cap = await capturePagerSwitch(page, async () => {
			await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
			await page.waitForURL('/messages/inbox');
		});
		expect(cap.animated, 'pager track slid to the Messages tab').toBe(true);
		expect(cap.firstPanel, 'started on Discussions').toBe('discussions');
		expect(cap.lastPanel, 'landed on Messages').toBe('messages');
	});

	// ---- Bug 4: header mode inconsistency between the two compose routes ----
	// /post/discussion and /messages/new are both compose forms, but the Header
	// treats them differently. resolveHeaderMode (header-mode.ts) keys off
	// getCurrentTabIndex, which uses tab-config.ts matchers: discussions matches
	// `p === '/' || p.startsWith('/discussion')` (so /post/discussion, which
	// starts with /post/, is NOT matched -> deep mode, back arrow + empty title),
	// while messages matches `p.startsWith('/messages')` (so /messages/new IS
	// matched -> root mode, the 3-icon tab bar with Messages highlighted). Same
	// kind of route, two different headers. This test locks the inconsistency in.
	test('Bug 4: /post/discussion is deep-mode but /messages/new is root-mode (tab bar)', async ({
		page
	}) => {
		const modeOf = async (pathname: string): Promise<{ idx: number; tabbarVisible: boolean }> => {
			return page.evaluate((p) => {
				const matchers: ((s: string) => boolean)[] = [
					(s) => s === '/' || s.startsWith('/discussion'),
					(s) => s.startsWith('/activity'),
					(s) => s.startsWith('/messages')
				];
				const idx = matchers.findIndex((m) => m(p));
				const rootLayer = document.querySelector(
					'header div.absolute.inset-0.flex.items-center.justify-center'
				) as HTMLElement | null;
				const tabbarVisible = rootLayer
					? !rootLayer.style.transform.includes('-100%')
					: false;
				return { idx, tabbarVisible };
			}, pathname);
		};

		await page.goto('/');
		await waitForHydration(page);
		await page.locator('[data-testid="fab"]').click();
		await page.waitForURL('/post/discussion');
		await page.waitForTimeout(400);
		const post = await modeOf('/post/discussion');

		await page.goto('/');
		await waitForHydration(page);
		await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(300);
		await page.locator('[data-testid="fab"]').click();
		await page.waitForURL('/messages/new');
		await page.waitForTimeout(400);
		const msg = await modeOf('/messages/new');

		expect(post.idx, '/post/discussion is no tab -> deep mode (back arrow)').toBe(-1);
		expect(post.tabbarVisible, '/post/discussion hides the tab bar').toBe(false);
		expect(msg.idx, '/messages/new is misclassified as the messages tab').toBe(2);
		expect(msg.tabbarVisible, '/messages/new shows the tab bar (inconsistent with /post/discussion)').toBe(
			true
		);
	});

	// ---- Bug 3 (reported): DualColumnLayout tab-swipe misfires on /messages/new
	// The reported "拉开之后内容右移、没有新 Column、底部边距锁住" is
	// DualColumnLayout's tab-swipe activating on the messages compose form.
	// swipeDisabled (DualColumnLayout.svelte:117) does NOT exclude /messages/new
	// (it is not a pager route, not /discussion/*, not /messages/<digit>), and
	// getSwipeBaseline('/messages/new') === 2 because the messages tab matcher
	// `p.startsWith('/messages')` over-matches it. So a rightward drag runs the
	// tab-swipe: it translateX's .dual-column-layout-content (clamped to 100px),
	// renders NO preview column, and on commit tabSwipeEnd goto's the
	// spatially-previous tab /activity (not back to /messages/inbox). The
	// "白色" revealed area is the body bg left visible behind the shifted content.
	test('Bug 3: /messages/new right-drag shifts content, no preview, commits to /activity', async ({
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

		// Per-frame sampler on .dual-column-layout-content's translateX + whether
		// any preview column is rendered, across the drag window.
		await page.evaluate(() => {
			const frames: { t: number; tx: number; preview: number }[] = [];
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
				frames.push({
					t: Math.round(performance.now() - start),
					tx: Math.round(tx),
					preview: document.querySelectorAll('[data-tab-panel], .detail-scroll-pane').length
				});
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
			() => (window as unknown as { __swipe: { frames: { tx: number; preview: number }[] } }).__swipe.frames
		);
		const maxTx = Math.max(...frames.map((f) => f.tx));
		// The peak-shift frame is mid-drag, before the release commits the nav to
		// /activity (which would itself mount pager [data-tab-panel] sections).
		// Assert THAT frame has no preview column.
		const peakFrame = frames.reduce((a, b) => (b.tx > a.tx ? b : a));
		expect(maxTx, 'content shifted right (tab-swipe ran on a compose form)').toBeGreaterThan(50);
		expect(peakFrame.preview, 'no preview column at peak shift (just the content shift)').toBe(0);
		expect(new URL(page.url()).pathname, 'committed to the wrong target (spatial prev tab, not back)').toBe(
			'/activity'
		);
	});

	// ---- Bug 3 edge: GPL chip mode when a GPL back target is a compose route --
	// A separate edge case (not the reported scenario but same compose-route
	// root cause): stack [/ -> /post/discussion -> /bookmarks]. On /bookmarks the
	// back target is the compose route /post/discussion, which has no
	// previewPanel, so GesturePageLayout enters chip mode on back-swipe.
	test('Bug 3 edge: GPL back-swipe enters chip mode when back target is a compose route', async ({
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
		expect(snap.chipMode, 'chip mode activated (compose back target is not previewable)').toBe(
			true
		);
		expect(
			snap.previewPanel,
			'no real preview <section> rendered (the chip stands in for the compose route)'
		).toBeNull();
		expect(snap.overlayWidth, 'overlay width is tanh-clamped (forced chip mode)').toBeLessThan(110);
	});
});
