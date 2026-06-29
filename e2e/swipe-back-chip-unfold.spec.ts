import { test, expect, type Page } from '@playwright/test';
import { prepareContext, openSidebarAndGoto, waitForHydration } from './helpers';

interface TabSample {
	t: number;
	activeTabs: string[];
	path: string;
}

async function installTabSampler(page: Page): Promise<void> {
	await page.evaluate(() => {
		const log: TabSample[] = [];
		(window as any).__tabLog = log;
		const tick = (): void => {
			const activeHrefs: string[] = [];
			const links = document.querySelectorAll('a[data-tab-nav]');
			links.forEach((el) => {
				const href = el.getAttribute('href') ?? '';
				const hasActiveAttr = el.getAttribute('aria-current') === 'page';
				const cls = el.getAttribute('class') ?? '';
				const hasActiveCls = /bg-neutral-content\/15/.test(cls) && /text-accent\b/.test(cls);
				if (hasActiveAttr || hasActiveCls) {
					activeHrefs.push(href);
				}
			});
			log.push({
				t: Math.round(performance.now()),
				activeTabs: activeHrefs,
				path: location.pathname
			});
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
}

async function readTabLog(page: Page): Promise<TabSample[]> {
	return page.evaluate(() => (window as any).__tabLog ?? []);
}

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

test('BUG: back-swipe from bookmarks to messages unfolds Discussions and Activity chips', async ({ page }) => {
	// 1. Go to inbox messages page
	await page.goto('/messages/inbox');
	await waitForHydration(page);

	// 2. Open sidebar and go to /bookmarks
	await openSidebarAndGoto(page, '/bookmarks');
	expect(new URL(page.url()).pathname).toBe('/bookmarks');
	await page.waitForTimeout(300);

	// 3. Install tab active status sampler
	await installTabSampler(page);

	// 4. Slowly simulate the swipe back gesture using CDP TouchEvents
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

	const width = page.viewportSize()?.width ?? 393;
	const startX = 60; // Well outside the 40px edge dead-zone
	const endX = 360; // Ensure drag is long enough to highlight tabs
	const y = 400;

	// Perform a slow drag
	await client.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [{ state: 'touchPressed', x: startX, y, id: 1 }] as unknown as any,
		modifiers: 0,
		timestamp: 0
	});
	await page.waitForTimeout(50);

	const steps = 30;
	for (let i = 1; i <= steps; i++) {
		const x = Math.round(startX + (endX - startX) * (i / steps));
		await client.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ state: 'touchMoved', x, y, id: 1 }] as unknown as any,
			modifiers: 0,
			timestamp: 0
		});
		await page.waitForTimeout(40); // Slow moving interval to let sampler capture frames
	}

	await client.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [{ state: 'touchReleased', x: endX, y, id: 1 }] as unknown as any,
		modifiers: 0,
		timestamp: 0
	});
	await client.detach();

	// 5. Wait to land back on /messages/inbox
	await page.waitForURL('/messages/inbox', { timeout: 5000 });
	expect(new URL(page.url()).pathname).toBe('/messages/inbox');

	// Wait a bit to capture final state
	await page.waitForTimeout(300);

	// 6. Read logs and check for incorrect highlighting of Discussions or Activity tab
	const log = await readTabLog(page);
	expect(log.length, 'Sampler must have captured frames').toBeGreaterThan(10);

	const discussionsActiveFrames = log.filter((s) => s.activeTabs.includes('/'));
	const activityActiveFrames = log.filter((s) => s.activeTabs.includes('/activity'));

	console.log('Discussions active frames count:', discussionsActiveFrames.length);
	console.log('Activity active frames count:', activityActiveFrames.length);

	// Both Discussions and Activity tabs should never highlight during this back swipe.
	expect(discussionsActiveFrames.length, 'Discussions tab highlighted during back swipe to Messages').toBe(0);
	expect(activityActiveFrames.length, 'Activity tab highlighted during back swipe to Messages').toBe(0);
});

test('NEW BUG: back-swipe from bookmarks after entering via sidebar returns to discussion list, not messages', async ({ page }) => {
	// 1. Start at homepage
	await page.goto('/');
	await waitForHydration(page);

	// 2. Click Messages tab in the top tab bar
	await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
	await page.waitForURL('/messages/inbox');
	await page.waitForTimeout(300);

	// 3. Open the sidebar drawer by clicking the menu button
	const menuBtn = page.locator('header button').first();
	await expect(menuBtn).toBeVisible();
	await menuBtn.click();
	await page.waitForTimeout(300);

	// 4. Click "收藏" link inside the mobile drawer
	const bookmarksLink = page.locator('a[href="/bookmarks"]').filter({ visible: true }).first();
	await expect(bookmarksLink).toBeVisible();
	await bookmarksLink.click();
	await page.waitForURL('/bookmarks');
	await page.waitForTimeout(300);

	// 5. Simulate swipe back using CDP TouchEvents
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

	const width = page.viewportSize()?.width ?? 393;
	const startX = 60;
	const endX = 320;
	const y = 400;

	await client.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [{ state: 'touchPressed', x: startX, y, id: 1 }] as unknown as any,
		modifiers: 0,
		timestamp: 0
	});
	await page.waitForTimeout(50);

	const steps = 14;
	for (let i = 1; i <= steps; i++) {
		const x = Math.round(startX + (endX - startX) * (i / steps));
		await client.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ state: 'touchMoved', x, y, id: 1 }] as unknown as any,
			modifiers: 0,
			timestamp: 0
		});
		await page.waitForTimeout(20);
	}

	await client.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [{ state: 'touchReleased', x: endX, y, id: 1 }] as unknown as any,
		modifiers: 0,
		timestamp: 0
	});
	await client.detach();

	// 6. We expect to land on /messages/inbox!
	await page.waitForURL('/messages/inbox', { timeout: 5000 });
	expect(new URL(page.url()).pathname).toBe('/messages/inbox');
});

test('NEW BUG: back-swipe from profile settings after entering via sidebar returns to messages, not homepage', async ({ page }) => {
	// 1. Start at homepage
	await page.goto('/');
	await waitForHydration(page);

	// 2. Click Messages tab in the top tab bar
	await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
	await page.waitForURL('/messages/inbox');
	await page.waitForTimeout(300);

	// 3. Open the sidebar drawer by clicking the menu button
	const menuBtn = page.locator('header button').first();
	await expect(menuBtn).toBeVisible();
	await menuBtn.click();
	await page.waitForTimeout(300);

	// 4. Click "Settings" link inside the mobile drawer
	const settingsLink = page.locator('a[href="/profile/settings"]').filter({ visible: true }).first();
	await expect(settingsLink).toBeVisible();
	await settingsLink.click();
	await page.waitForURL('/profile/settings');
	await page.waitForTimeout(300);

	// 5. Simulate swipe back using CDP TouchEvents
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

	const width = page.viewportSize()?.width ?? 393;
	const startX = 60;
	const endX = 320;
	const y = 400;

	await client.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [{ state: 'touchPressed', x: startX, y, id: 1 }] as unknown as any,
		modifiers: 0,
		timestamp: 0
	});
	await page.waitForTimeout(50);

	const steps = 14;
	for (let i = 1; i <= steps; i++) {
		const x = Math.round(startX + (endX - startX) * (i / steps));
		await client.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ state: 'touchMoved', x, y, id: 1 }] as unknown as any,
			modifiers: 0,
			timestamp: 0
		});
		await page.waitForTimeout(20);
	}

	await client.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [{ state: 'touchReleased', x: endX, y, id: 1 }] as unknown as any,
		modifiers: 0,
		timestamp: 0
	});
	await client.detach();

	// 6. We expect to land on /messages/inbox!
	await page.waitForURL('/messages/inbox', { timeout: 5000 });
	expect(new URL(page.url()).pathname).toBe('/messages/inbox');
});


