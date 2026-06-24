import { test, expect, type Page } from '@playwright/test';
import {
	prepareContext,
	swipeBack,
	openSidebarAndGoto,
	enterSource,
	waitForUrlNot,
	waitForHydration,
	collectConsole,
	type Entry,
	type Source
} from './helpers';

/**
 * Mobile back-swipe backTarget matrix - behavioural twin of the bun:test suite
 * in src/lib/stores/navigation-logic.test.ts. Drives real touch swipes through
 * CDP and asserts the landing URL. Each test is gated on the
 * `[detectSwipe] swipe activated!` console log so a silently-failed gesture
 * fails loudly instead of returning a misleading landing URL.
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
 * Run one scenario end-to-end and return { landed, activated }. Throws if the
 * gesture was not recognised (so the caller never trusts a stale URL).
 */
async function runScenario(
	page: Page,
	sc: Scenario
): Promise<{ landed: string; activated: boolean; console: string[] }> {
	await setupAuth(page.context());
	const console = collectConsole(page);
	await enterSource(page, sc.entry, sc.source);
	await openSidebarAndGoto(page, sc.target);
	expect(new URL(page.url()).pathname).toBe(sc.target);

	await swipeBack(page);
	// Hard gate: detectSwipe MUST have entered its swipe phase. If this is false
	// the landing URL below is meaningless (the gesture never committed).
	await page.waitForTimeout(200);
	const activated = console.some((m) => m.includes('swipe activated!'));
	const landed = await waitForUrlNot(page, sc.target);
	return { landed, activated, console };
}

// --- Calibration: the A4 control must PASS before any matrix result is trusted.
// If this fails, the harness (CDP touch / device emulation / selectors) is
// broken - do not read anything into the matrix below.
test('CALIBRATION: A4 (tab → messages → bookmarks) lands on messages', async ({ page }) => {
	const res = await runScenario(page, A_GROUP[3]);
	expect(res.activated, 'detectSwipe did not activate - gesture harness broken').toBe(true);
	expect(res.landed).toBe('/messages/inbox');
});

// --- The matrix. Pre-fix: A1,A2,A3,B1–B5 fail (land on `/`); A4,A5,A6,A7 pass.
for (const sc of [...A_GROUP, ...B_GROUP]) {
	test(`${sc.id}: ${sc.entry} entry, source=${sc.source}, target=${sc.target} → ${sc.expected}`, async ({
		page
	}) => {
		const res = await runScenario(page, sc);
		expect(
			res.activated,
			`detectSwipe did not activate for ${sc.id} - gesture result untrusted. console: ${res.console.join(' | ')}`
		).toBe(true);
		expect(res.landed).toBe(sc.expected);
	});
}

// --- Bug2: an empty-cache list panel renders the shared LoadingChip (the
// card-scaling target-page pill), not the old spinner + localized loading text.
// Triggered by landing directly on a global route (init sets activeTab=0; home
// is never visited so its cache is cold), so the back-preview's DiscussionsPanel
// renders its !data fallback.
//
// Asserted structurally (chip present, spinner markup absent) - locale-free, so
// it does not hardcode the t.common.loading string and holds under any locale.
test('Bug2: empty-cache panel shows the LoadingChip, not the spinner fallback', async ({ page, context }) => {
	await prepareContext(context);
	await page.goto('/bookmarks');
	await waitForHydration(page);
	await page.waitForTimeout(500);
	const chipCount = await page.locator('.loading-chip').count();
	const spinnerCount = await page.locator('.loading.loading-spinner').count();
	expect(chipCount, 'the shared LoadingChip should render for the cold-cache panel').toBeGreaterThan(0);
	expect(spinnerCount, 'the old spinner must be gone').toBe(0);
});
