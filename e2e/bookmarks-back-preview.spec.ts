import { test, expect } from '@playwright/test';
import { prepareContext, swipeBack, waitForHydration, waitForUrlNot, openSidebarAndGoto } from './helpers';

/**
 * On a deep page reached from a thread (/ -> thread -> /bookmarks), the
 * back-swipe's left preview shows the back-target thread, and back lands on
 * that thread (history) — preview and target agree.
 */
test('bookmarks back-swipe previews the back-target thread, not the home list', async ({
	page,
	context
}) => {
	await prepareContext(context);
	await page.goto('/');
	await waitForHydration(page);

	// / -> thread
	await page.locator('a[href^="/discussion/"]').first().click();
	await page.waitForURL(/\/discussion\//);
	const threadId = await page.evaluate(() => location.pathname.match(/^\/discussion\/(\d+)/)?.[1]);

	// -> bookmarks (drawer-style SPA nav)
	await openSidebarAndGoto(page, '/bookmarks');

	// Left panel must NOT render the full home list (20 thread links) — it should
	// preview the back-target thread instead.
	const left = await page.evaluate(() => {
		const track = document.querySelector('.flex.items-start');
		const l = track?.children[0] as HTMLElement | undefined;
		return {
			listLinks: l ? l.querySelectorAll('a[href*="/discussion/"]').length : -1,
			text: (l?.textContent || '').trim().slice(0, 60)
		};
	});
	expect(left.listLinks, 'left panel must not render the full home list').toBe(0);

	// Back lands on the thread (history), not the home list.
	await swipeBack(page);
	const landed = await waitForUrlNot(page, '/bookmarks');
	expect(landed, 'back must land on the thread (history)').toMatch(/\/discussion\//);
	if (threadId) {
		expect(landed).toContain(`/discussion/${threadId}`);
	}
});
