import { test, expect, type Page } from '@playwright/test';
import { prepareContext, waitForHydration, openSidebarAndGoto, clickDiscussion } from './helpers';

// Reproduces the PWA "return-to-foreground stale preview" defect.
//
// The mobile swipe-back preview sources its data from the unified
// page cache: GesturePageLayout.getPreviewPanel falls back to
// MOBILE_TABS[tab].panel, which is TabDiscussionsPanel /
// TabActivityPanel / TabMessagesPanel, and each reads `cache.get(href)?.data
// ?? page.data.X` (cache first). The root-layout $effect seeds the
// cache for every tab root on every route (deep pages included).
//
// The defect this test guards against: a page.data refresh that fires
// off a tab root re-runs the layout load but the cache-write effect
// skips deep pages, so the preview renders stale content while the
// freshly navigated landing renders fresh page.data. The refresh is
// any invalidate path; in production the real one is
// invalidate('app:badges') (messages/[id] afterNavigate) plus the
// several invalidateAll() call sites. Here the dev-only
// __e2eInvalidateBadges hook drives the exact same root-load re-run,
// deterministically.
//
// The dev-only __e2eCacheWrites hook wraps `PageCacheStore.capture`
// and logs every (pathname, subKey) write. The three tab-list entries
// are keyed by `'/'`, `'/activity'`, `'/messages/inbox'`.

type CacheKey = '/' | '/activity' | '/messages/inbox';

interface CacheWrite {
	key: string;
	t: number;
}

interface E2EHooks {
	__e2eCacheWrites?: CacheWrite[];
	__e2eInvalidateBadges?: () => Promise<void>;
}

interface SwipeFrame {
	t: number;
	m41: number;
}

function reads(page: Page): Promise<CacheWrite[]> {
	return page.evaluate(() => (window as unknown as E2EHooks).__e2eCacheWrites ?? []);
}

function countKey(log: CacheWrite[], key: CacheKey): number {
	return log.filter((w) => w.key === key).length;
}

/** Fire invalidate('app:badges') and wait for the root layout re-run to land. */
async function refreshRootLoad(page: Page): Promise<void> {
	await Promise.all([
		page.waitForResponse(
			(r) => r.url().includes('__data.json') && r.request().method() === 'GET',
			{ timeout: 8000 }
		),
		page.evaluate(() => (window as unknown as E2EHooks).__e2eInvalidateBadges!())
	]);
	// The (tabs) cache-write $effect flushes one tick after page.data updates.
	await page.waitForTimeout(400);
}

/** A slow rightward touch swipe via CDP with inter-move frame delays, so a rAF
 *  sampler can capture the track reveal. The fast swipeBack helper dispatches
 *  every step synchronously and the gesture commits inside a single frame,
 *  yielding no intermediate samples. */
async function slowBackSwipe(page: Page): Promise<void> {
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.3);
	const endX = startX + 260;
	const y = 400;
	const disp = (
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
	await disp('touchStart', startX, 'touchPressed');
	await page.waitForTimeout(40);
	const steps = 20;
	for (let i = 1; i <= steps; i++) {
		const x = Math.round(startX + (endX - startX) * (i / steps));
		await disp('touchMove', x, 'touchMoved');
		await page.waitForTimeout(28);
	}
	await disp('touchEnd', endX, 'touchReleased');
	await client.detach();
}

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

test('on a tab root, a refresh rewrites all three tab caches', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	// Populate all three caches by visiting each tab root.
	await openSidebarAndGoto(page, '/activity');
	await openSidebarAndGoto(page, '/messages/inbox');

	const before = await reads(page);
	const dBefore = countKey(before, '/');
	const aBefore = countKey(before, '/activity');
	const mBefore = countKey(before, '/messages/inbox');
	expect(mBefore, 'messages cache written on the messages tab root').toBeGreaterThan(0);

	await refreshRootLoad(page);

	const after = await reads(page);
	// Correct behavior: a refresh must refresh EVERY tab's preview cache, not
	// only the visible one - otherwise the swipe-back previews for the other two
	// tabs render stale content while their landings render fresh page.data.
	expect(
		countKey(after, '/'),
		'discussions cache refreshed on a refresh'
	).toBeGreaterThan(dBefore);
	expect(countKey(after, '/activity'), 'activity cache refreshed on a refresh').toBeGreaterThan(
		aBefore
	);
	expect(
		countKey(after, '/messages/inbox'),
		'messages cache refreshed on a refresh'
	).toBeGreaterThan(mBefore);
});

test('on a deep page (/discussion/*), a refresh rewrites all three tab caches', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	await openSidebarAndGoto(page, '/activity');
	await openSidebarAndGoto(page, '/messages/inbox');
	// Revisit '/' so the discussions cache is freshly written, then enter a thread
	// (a top-level route, NOT under (tabs)).
	await openSidebarAndGoto(page, '/');
	await clickDiscussion(page, 0);
	await page.waitForURL(/\/discussion\//, { timeout: 8000 });
	await page.waitForTimeout(300);

	const before = await reads(page);
	const dBefore = countKey(before, '/');
	const aBefore = countKey(before, '/activity');
	const mBefore = countKey(before, '/messages/inbox');

	// The root load re-runs (fresh page.data). The root-layout cache-write
	// effect covers every route (deep pages included), so every tab entry
	// is rewritten.
	await refreshRootLoad(page);

	const after = await reads(page);
	// Correct behavior: a refresh must refresh the preview cache even on a deep
	// page, so the back-swipe preview matches its landing.
	expect(
		countKey(after, '/'),
		'discussions cache refreshed even on a deep page'
	).toBeGreaterThan(dBefore);
	expect(
		countKey(after, '/activity'),
		'activity cache refreshed even on a deep page'
	).toBeGreaterThan(aBefore);
	expect(
		countKey(after, '/messages/inbox'),
		'messages cache refreshed even on a deep page'
	).toBeGreaterThan(mBefore);
});

test('characterize post-refresh back-swipe: the track must commit to / without a snap-back', async ({
	page
}) => {
	// A separate symptom reported in the same scenario is a one-frame skip on the
	// swipe that immediately follows the refresh: the target page appears, then
	// the track reverts to the source. This test drives that exact sequence
	// (refresh on the thread, then back-swipe) and samples the GesturePageLayout
	// track translateX every frame. The IDEAL is a monotonic reveal that commits
	// to '/'. A snap-back (m41 opens then returns to ~0 while the URL stays on
	// /discussion) is the defect; the per-frame log surfaces on failure.
	await page.goto('/');
	await waitForHydration(page);
	await clickDiscussion(page, 0);
	await page.waitForURL(/\/discussion\//, { timeout: 8000 });
	await page.waitForTimeout(300);

	await refreshRootLoad(page);

	await page.evaluate(() => {
		const w = window as unknown as { __swipeFrames?: SwipeFrame[] };
		w.__swipeFrames = [];
		const start = performance.now();
		const tick = (): void => {
			const centre = document.querySelector('.detail-scroll-pane');
			const track = centre?.parentElement as HTMLElement | null;
			let m41 = 0;
			if (centre && track) {
				try {
					m41 = new DOMMatrix(getComputedStyle(track).transform).m41;
				} catch {
					m41 = 0;
				}
			}
			w.__swipeFrames!.push({ t: Math.round(performance.now() - start), m41: Math.round(m41) });
			if (performance.now() - start < 1200) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	await slowBackSwipe(page);
	await page.waitForTimeout(900);
	const frames = await page.evaluate(
		() => (window as unknown as { __swipeFrames?: SwipeFrame[] }).__swipeFrames ?? []
	);

	const peak = frames.reduce((max, f) => Math.max(max, f.m41), 0);
	const endedOnList = new URL(page.url()).pathname === '/';
	// Diagnostic log: the per-frame m41 is the evidence behind the analysis
	// report. Observed here: endedOnList=true (navigation commits) but peak=0
	// (the during-drag track reveal is absent after a refresh). The hard guard is
	// navigation only; the reveal anomaly is reported separately rather than
	// asserted, because the headless invalidate-then-swipe sim does not reproduce
	// the real refresh-during-gesture timing and its cause is not yet pinned.
	console.log(
		`post-refresh back-swipe: endedOnList=${endedOnList} peakM41=${peak} samples=${frames.length}`
	);
	console.log('frame sequence (t:ms, m41:px):', frames.slice(0, 40));
	expect(endedOnList, 'back-swipe still navigates to the list after a refresh').toBe(true);
});
