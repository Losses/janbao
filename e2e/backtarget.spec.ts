import { test, expect, type Page } from '@playwright/test';
import {
	prepareContext,
	swipeBack,
	openSidebarAndGoto,
	enterSource,
	waitForUrlNot,
	waitForHydration,
	type Entry,
	type Source
} from './helpers';

/**
 * Mobile back-swipe backTarget matrix - behavioural twin of the bun:test suite
 * in src/lib/stores/navigation-logic.test.ts. Drives real touch swipes through
 * CDP and asserts the landing URL.
 */

interface Scenario {
	id: string;
	entry: Entry;
	source: Source;
	target: string;
	expected: string;
}

const A_GROUP: Scenario[] = [
	{ id: 'A1', entry: 'hard', source: 'messages', target: '/bookmarks', expected: '/messages/inbox' },
	{ id: 'A2', entry: 'hard', source: 'activity', target: '/bookmarks', expected: '/activity' },
	{ id: 'A3', entry: 'reload', source: 'messages', target: '/bookmarks', expected: '/messages/inbox' },
	{ id: 'A4', entry: 'tab', source: 'messages', target: '/bookmarks', expected: '/messages/inbox' },
	{ id: 'A5', entry: 'tab', source: 'activity', target: '/bookmarks', expected: '/activity' },
	{ id: 'A6', entry: 'sidebar', source: 'messages', target: '/bookmarks', expected: '/messages/inbox' },
	{ id: 'A7', entry: 'hard', source: 'discussion', target: '/bookmarks', expected: '/' }
];

const GLOBAL_TARGETS = ['/bookmarks', '/notifications', '/profile', '/search', '/admin'];
const B_GROUP: Scenario[] = GLOBAL_TARGETS.map((target, i) => ({
	id: `B${i + 1}`,
	entry: 'hard' as Entry,
	source: 'messages' as Source,
	target,
	expected: '/messages/inbox'
}));

async function setupAuth(context: import('@playwright/test').BrowserContext): Promise<void> {
	await prepareContext(context);
}

/**
 * Run one scenario end-to-end and return the post-swipe landing pathname. The
 * gesture activating AND committing is proven by the URL leaving `sc.target`:
 * waitForUrlNot times out if detectSwipe never recognised the drag, so a
 * silently-failed gesture still fails loudly.
 */
async function runScenario(page: Page, sc: Scenario): Promise<{ landed: string }> {
	await setupAuth(page.context());
	await enterSource(page, sc.entry, sc.source);
	await openSidebarAndGoto(page, sc.target);
	expect(new URL(page.url()).pathname).toBe(sc.target);

	await swipeBack(page);
	await page.waitForTimeout(200);
	const landed = await waitForUrlNot(page, sc.target);
	return { landed };
}

// --- Calibration: the A4 control must PASS before any matrix result is trusted.
// If this fails, the harness (CDP touch / device emulation / selectors) is
// broken - do not read anything into the matrix below.
test('CALIBRATION: A4 (tab → messages → bookmarks) lands on messages', async ({ page }) => {
	const res = await runScenario(page, A_GROUP[3]);
	expect(res.landed).toBe('/messages/inbox');
});

// --- The matrix. Pre-fix: A1,A2,A3,B1–B5 fail (land on `/`); A4,A5,A6,A7 pass.
for (const sc of [...A_GROUP, ...B_GROUP]) {
	test(`${sc.id}: ${sc.entry} entry, source=${sc.source}, target=${sc.target} → ${sc.expected}`, async ({
		page
	}) => {
		const res = await runScenario(page, sc);
		expect(res.landed).toBe(sc.expected);
	});
}

// --- Bug2: an empty-cache list panel renders discussions from SvelteKit
// layout data, not a spinner + localized loading text.
// Triggered by landing directly on a global route (init sets activeTab=0; home
// is never visited so its cache is cold), so the back-preview's DiscussionsPanel
// falls back to SvelteKit layout data.
//
// Asserted structurally (discussions present, spinner markup absent) - locale-free, so
// it does not hardcode the t.common.loading string and holds under any locale.
test('Bug2: cold-cache panel falls back to layout data, rendering discussions instead of spinner', async ({ page, context }) => {
	await prepareContext(context);
	await page.goto('/bookmarks');
	await waitForHydration(page);
	await page.waitForTimeout(500);

	const discussionsCount = await page.locator('a[href^="/discussion/"]').count();
	const spinnerCount = await page.locator('.loading.loading-spinner').count();
	expect(discussionsCount, 'discussions must render from layout data').toBeGreaterThan(0);
	expect(spinnerCount, 'no spinner renders').toBe(0);
});

// --- Bug3: on a deep page back-swipe the top tab pill must track the finger
// (animate toward the back-target tab), not stay frozen and snap after nav. The
// expansion must also be GRADUAL (not full after a tiny drag) and monotonic.
test('Bug3: deep-page back-swipe animates the top tab pill gradually', async ({ page, context }) => {
	await prepareContext(context);
	await page.goto('/');
	await waitForHydration(page);
	await openSidebarAndGoto(page, '/bookmarks');
	await page.waitForTimeout(300);

	// The discussions pill's label width tracks `closeness` live (0 at rest on a
	// non-tab page, growing as the gesture moves toward home).
	const labelWidth = () =>
		page.locator('a[data-tab-nav][href="/"] span.overflow-hidden').first().evaluate((el) => {
			return (el as HTMLElement).offsetWidth;
		});
	// The pill's fully-expanded label width, for a "not full yet" ceiling.
	const fullLabel = await page
		.locator('a[data-tab-nav][href="/"] span.overflow-hidden')
		.first()
		.evaluate((el) => el.scrollWidth);

	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const before = await labelWidth();

	const move = (x: number) =>
		client.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ x, y: 400, id: 1 }],
			modifiers: 0,
			timestamp: 0
		});
	await client.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [{ x: 50, y: 400, id: 1 }],
		modifiers: 0,
		timestamp: 0
	});
	// Sample at three drag distances WITHOUT releasing → expansion must be
	// monotonic (gradual) and far from full at the first sample.
	// Since the target tab pill intentionally lags behind the bar (starts
	// expanding after 50% drag progress, i.e. > 196.5px drag distance), we drag
	// from x=50 to x=260/290/320 (dx=210px/240px/270px) to verify expansion.
	await move(260);
	await page.waitForTimeout(30);
	const small = await labelWidth();
	await move(290);
	await page.waitForTimeout(30);
	const mid = await labelWidth();
	await move(320);
	await page.waitForTimeout(30);
	const large = await labelWidth();
	await client.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [{ x: 320, y: 400, id: 1 }],
		modifiers: 0,
		timestamp: 0
	});
	await client.detach();

	expect(before, 'pill collapsed at rest on a non-tab page').toBeLessThan(5);
	expect(small, 'pill must start expanding early').toBeGreaterThan(before);
	expect(small, 'pill must NOT be fully expanded after a small drag').toBeLessThan(fullLabel * 0.8);
	expect(mid, 'expansion must be gradual/monotonic').toBeGreaterThan(small);
	expect(large, 'expansion must keep growing').toBeGreaterThan(mid);
});

test('Bug4: global page (search) back-swipe shows the Discussions preview panel instead of loading chip', async ({ page, context }) => {
	await prepareContext(context);
	await page.goto('/search');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

	await client.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [{ x: 50, y: 400, id: 2 }],
		modifiers: 0,
		timestamp: 0
	});

	await client.send('Input.dispatchTouchEvent', {
		type: 'touchMove',
		touchPoints: [{ x: 250, y: 400, id: 2 }],
		modifiers: 0,
		timestamp: 0
	});

	await page.waitForTimeout(100);

	const metrics = await page.evaluate(() => {
		const preview = document.querySelector('section[data-tab-panel="discussions"]') as HTMLElement | null;
		const overlay = document.querySelector('.loading-overlay') as HTMLElement | null;
		return {
			hasPreview: !!preview,
			isPreviewVisible: preview ? window.getComputedStyle(preview).display !== 'none' : false,
			hasOverlay: !!overlay
		};
	});

	await client.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [{ x: 250, y: 400, id: 2 }],
		modifiers: 0,
		timestamp: 0
	});
	await client.detach();

	expect(metrics.hasPreview, 'the discussions preview section must exist').toBe(true);
	expect(metrics.isPreviewVisible, 'the discussions preview section must be visible').toBe(true);
	expect(metrics.hasOverlay, 'no loading overlay should be visible').toBe(false);
});

/**
 * activeIndex=0 backward-to-deep-page trajectory. Land on `/bookmarks` (a deep
 * page, not a tab root), tap the discussions tab to navigate to `/` (now the
 * leftmost tab, activeIndex=0, with `/bookmarks` as the previous history
 * entry), then commit a rightward back-swipe. The CONTRACT being asserted is
 * the landing: history.back() must return to the deep page (`/bookmarks`), not
 * pop a tab. The slide is SUPPRESSED for this case (the leftmost tab has no
 * panel to its left, so `suppressSlide` sets `distance = 0`); this test
 * asserts only the landing URL.
 */
test('activeIndex=0 backward-to-deep-page: back-swipe on / commits to prior deep history entry (/bookmarks)', async ({ page, context }) => {
	await prepareContext(context);

	// 1. Land on a deep page that is NOT a tab root. `/bookmarks` becomes the
	//    previous history entry after the tab tap below.
	await page.goto('/bookmarks');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	// 2. SPA-navigate to `/` (the discussions tab root). On a deep page the
	//    Header's tab bar is faded (the title layer covers the tab links), so
	//    drive the nav via the dev goto hook, which fires the same SvelteKit
	//    navigation a tab tap does. The orchestrator consumes the tab-root
	//    target and `#dispatchNav('/')` pushes `/` (`hopForHref` returns 'push'
	//    on the deep-linked single-entry history), giving history
	//    `[/bookmarks, /]`: activeIndex=0 with `/bookmarks` as the previous
	//    entry - the backward-gesture targets the previous entry (macro §6).
	await openSidebarAndGoto(page, '/');
	await page.waitForTimeout(300);

	// 3. Rightward back-swipe past the commit threshold (dx=260 > SWIPE_COMMIT).
	//    swipeBack drives a real CDP touch swipe, the only path detectSwipe
	//    recognises (it rejects pointerType 'mouse').
	await swipeBack(page);

	// 4. The gesture commits and history.back() lands on `/bookmarks` (the deep
	//    previous entry), proving the activeIndex=0 path pops history rather
	//    than switching to a (non-existent) panel to the left.
	await page.waitForURL('/bookmarks');
	expect(new URL(page.url()).pathname).toBe('/bookmarks');
});



