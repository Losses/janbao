import { test, expect, type Page } from '@playwright/test';
import { prepareContext, swipeBack, swipeForward, waitForHydration, waitForUrlNot } from './helpers';

/**
 * Tab-switch history hygiene: toggling between two tabs must NOT push a new
 * history entry each time. Once the first cross-tab hop exists, every later
 * toggle collapses to history.back/forward (see hopForHref in
 * src/lib/utils/history-nav.ts), so the stack stays bounded and the user can
 * browser-back out of the app instead of being trapped in a growing loop of
 * duplicate entries. Asserted directly on navigation.entries().length - a
 * synthetic page.goBack() past the app boundary is flaky in headless Chrome, so
 * we test the underlying invariant (bounded stack) instead.
 */

async function entryCount(page: Page): Promise<number> {
	return page.evaluate(() => {
		const nav = (window as { navigation?: { entries: () => unknown[] } }).navigation;
		return nav ? nav.entries().length : -1;
	});
}

test('toggling two tabs via tab-bar tap does not grow the history stack', async ({ page, context }) => {
	await prepareContext(context);
	await page.goto('/');
	await waitForHydration(page);
	const start = await entryCount(page);

	// Tap Discussions <-> Activity several times. The first hop pushes; every
	// later one hops (back/forward), so the stack grows by at most ~1.
	for (let i = 0; i < 4; i++) {
		await page.locator('a[data-tab-nav][href="/activity"]').click();
		await waitForUrlNot(page, '/');
		await page.locator('a[data-tab-nav][href="/"]').click();
		await waitForUrlNot(page, '/activity');
	}
	const end = await entryCount(page);
	expect(end - start).toBeLessThanOrEqual(2);
});

test('toggling two tabs via swipe does not grow the history stack', async ({ page, context }) => {
	await prepareContext(context);
	await page.goto('/');
	await waitForHydration(page);
	const start = await entryCount(page);

	for (let i = 0; i < 4; i++) {
		await swipeForward(page); // / -> /activity
		await waitForUrlNot(page, '/');
		await swipeBack(page); // /activity -> /
		await waitForUrlNot(page, '/activity');
	}
	const end = await entryCount(page);
	expect(end - start).toBeLessThanOrEqual(2);
});
