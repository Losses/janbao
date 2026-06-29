import { test, expect } from '@playwright/test';
import {
	prepareContext,
	swipeForward,
	swipeBack,
	waitForHydration,
	clickDiscussion,
	waitForUrlNot
} from './helpers';

test.describe('Reproduction of User Reported Navigation Bugs', () => {
	test.beforeEach(async ({ context }) => {
		await prepareContext(context);
	});

	test('Bug 1: click tab to enter Activity from discussion page, then swipe back should return to discussion, not discussions list', async ({ page }) => {
		page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
		
		// 1. Start at homepage (Discussions list)
		await page.goto('/');
		await waitForHydration(page);

		// 2. Click the first discussion to enter thread detail
		await clickDiscussion(page, 0);
		await page.waitForURL(/\/discussion\//);
		await page.waitForSelector('.detail-scroll-pane');
		const discussionPath = new URL(page.url()).pathname;
		
		// Settle enter animation
		await page.waitForTimeout(500);

		// 3. Click the Activity tab in the Header (Action Bar)
		await page.locator('a[data-tab-nav][href="/activity"]').click();
		await page.waitForURL('/activity');
		await page.waitForTimeout(500);

		// 4. Swipe back (left-to-right gesture) to return to the discussion
		await swipeBack(page);
		
		// We expect to land back on the originating discussion
		await page.waitForURL(/\/discussion\//);
		const landedPath = new URL(page.url()).pathname;
		
		console.log('Landed path for Bug 1:', landedPath);
		expect(landedPath, 'Swiping back from Activity should return to the discussion page').toBe(discussionPath);
	});

	test('Bug 2: swipe forward to Activity, swipe back to Discussion, then click Activity tab should land on Activity, not snap back to Discussions list', async ({ page }) => {
		page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));

		// 1. Start at homepage (Discussions list)
		await page.goto('/');
		await waitForHydration(page);

		// 2. Click the first discussion to enter thread detail
		await clickDiscussion(page, 0);
		await page.waitForURL(/\/discussion\//);
		await page.waitForSelector('.detail-scroll-pane');
		
		// Settle enter animation
		await page.waitForTimeout(500);

		// 3. Swipe forward (right-to-left gesture) to enter Activity
		await swipeForward(page);
		await page.waitForURL('/activity');
		await page.waitForTimeout(500);

		// 4. Swipe back (left-to-right gesture) to go back to Discussion
		await swipeBack(page);
		await page.waitForURL(/\/discussion\//);
		await page.waitForTimeout(500);

		// 5. Click the Activity tab (top tab) in the Header
		await page.locator('a[data-tab-nav][href="/activity"]').click();
		
		// Wait to see if we land on /activity or if it snaps back to /
		await page.waitForTimeout(1000);
		const finalPath = new URL(page.url()).pathname;
		
		console.log('Landed path for Bug 2:', finalPath);
		expect(finalPath, 'Clicking Activity tab should keep us on /activity').toBe('/activity');
	});

	test('Bug 3: thread -> Message tab click -> swipe back twice lands on thread', async ({ page }) => {
		page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));

		// 1. Start at homepage (Discussions list)
		await page.goto('/');
		await waitForHydration(page);

		// 2. Click the first discussion to enter thread detail
		await clickDiscussion(page, 0);
		await page.waitForURL(/\/discussion\//);
		await page.waitForSelector('.detail-scroll-pane');
		const discussionPath = new URL(page.url()).pathname;
		
		// Settle enter animation
		await page.waitForTimeout(500);

		// 3. Click the Messages tab in the Header (Action Bar)
		await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(500);

		// 4. Swipe back once -> should land on /activity
		await swipeBack(page);
		await page.waitForURL('/activity');
		await page.waitForTimeout(500);

		// 5. Swipe back twice -> should go back to the discussion page
		await swipeBack(page);
		await page.waitForTimeout(1000);
		const landedPath = new URL(page.url()).pathname;
		console.log('Landed path for Bug 3 (after 2 swipes):', landedPath);
		
		expect(landedPath).toBe(discussionPath);
	});

	test('Bug 4: search page swipe back to home has preview card instead of loading chip', async ({ page }) => {
		page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));

		// 1. Start at homepage
		await page.goto('/');
		await waitForHydration(page);

		// 2. Go to search
		await page.goto('/search?q=test');
		await waitForHydration(page);

		// 3. Start a swipe back (drag right) on the search viewport
		const box = await page.locator('[data-search-scope-pager]').boundingBox();
		if (!box) throw new Error('Search scope pager not found');

		const startX = box.x + 50;
		const startY = box.y + 150;
		
		await page.mouse.move(startX, startY);
		await page.mouse.down();
		
		// Drag right by 120px to reveal Discussions tab preview
		await page.mouse.move(startX + 120, startY, { steps: 5 });
		await page.waitForTimeout(200);

		// Assert that the preview section is visible and matches "discussions"
		const leftPreview = page.locator('section[data-preview-tab="discussions"]');
		await expect(leftPreview).toBeVisible();

		// Assert that no loading overlay or loading chip is visible
		const loadingOverlay = page.locator('.loading-overlay');
		await expect(loadingOverlay).not.toBeVisible();

		await page.mouse.up();
	});

	test('Bug 5: search page swipe left (forward out of bounds) is intercepted and does not show overlay', async ({ page }) => {
		page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));

		// 1. Go to search
		await page.goto('/search?q=test');
		await waitForHydration(page);

		// 2. Start a swipe left (drag left) on the search viewport
		const box = await page.locator('[data-search-scope-pager]').boundingBox();
		if (!box) throw new Error('Search scope pager not found');

		const startX = box.x + box.width - 50;
		const startY = box.y + 150;

		await page.mouse.move(startX, startY);
		await page.mouse.down();

		// Drag left by 120px (out of bounds since there is no right panel)
		await page.mouse.move(startX - 120, startY, { steps: 5 });
		await page.waitForTimeout(200);

		// Assert that no loading overlay is visible
		const loadingOverlay = page.locator('.loading-overlay');
		await expect(loadingOverlay).not.toBeVisible();

		await page.mouse.up();
	});

	test('Bug 6: direct navigate to search -> swipe back -> no duplicate header morph animation', async ({ page }) => {
		page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));

		// 1. Directly go to search
		await page.goto('/search?q=test');
		await waitForHydration(page);

		// 2. Swipe back using the robust CDP touch helper
		await swipeBack(page);
		
		// 3. Verify that it successfully lands on the homepage '/'
		await page.waitForURL('/');
		const landedPath = new URL(page.url()).pathname;
		expect(landedPath).toBe('/');

		// Verify that the header track style is back to translateX(0%) without residual offsets
		const transform = await page.locator('header .flex.w-\\[200\\%\\]').evaluate(el => el.style.transform);
		expect(transform).toBe('translateX(0%)');
	});

	test('Bug 7: direct navigate to search -> swipe back -> preview has discussions rows rendered', async ({ page }) => {
		page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));

		// 1. Directly go to search
		await page.goto('/search?q=test');
		await waitForHydration(page);

		// 2. Start a swipe back (drag right) on the search viewport
		const box = await page.locator('[data-search-scope-pager]').boundingBox();
		if (!box) throw new Error('Search scope pager not found');

		const startX = box.x + 50;
		const startY = box.y + 150;
		
		await page.mouse.move(startX, startY);
		await page.mouse.down();
		
		// Drag right by 150px to reveal Discussions tab preview
		await page.mouse.move(startX + 150, startY, { steps: 5 });
		await page.waitForTimeout(200);

		// Assert that the preview section's discussion rows are visible (meaning layout fallback worked)
		const row = page.locator('section[data-preview-tab="discussions"] a[href^="/discussion/"]').first();
		await expect(row).toBeVisible();

		await page.mouse.up();
	});

	test('Bug 8: direct navigate to search -> drag left (opposite direction) -> no header morph', async ({ page }) => {
		page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));

		// 1. Directly go to search
		await page.goto('/search?q=test');
		await waitForHydration(page);

		// 2. Start a drag left (opposite direction since search has no right panel)
		const box = await page.locator('[data-search-scope-pager]').boundingBox();
		if (!box) throw new Error('Search scope pager not found');

		const startX = box.x + box.width - 50;
		const startY = box.y + 150;

		await page.mouse.move(startX, startY);
		await page.mouse.down();

		// Drag left by 100px (opposite/out-of-bounds)
		await page.mouse.move(startX - 100, startY, { steps: 5 });
		await page.waitForTimeout(200);

		// Assert that the header's tab bar is still fully expanded (not collapsed/morphed)
		// Because opposite drag shouldn't trigger header morph (backMorph stays 0)
		const maxCssHeight = await page.locator('header div.overflow-hidden.md\\:hidden').evaluate(el => (el as HTMLElement).style.maxHeight);
		expect(maxCssHeight).toContain('3rem');

		await page.mouse.up();
	});

	test('Bug 9: thread list -> click own avatar -> slide-in animation works -> swipe back returns to thread list', async ({ page, context }) => {
		page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));

		await prepareContext(context);
		// 1. Go to homepage
		await page.goto('/');
		await waitForHydration(page);

		// Find own avatar (admin is userId=0)
		const ownAvatar = page.locator('a[href^="/profile/0/"]').first();
		await expect(ownAvatar).toBeVisible();

		// Click on own avatar
		await ownAvatar.click();
		await page.waitForURL(/\/profile\/0\//);

		// Assert that the page is at /profile/0/admin
		expect(new URL(page.url()).pathname).toContain('/profile/0/');

		// Swipe back to homepage
		await swipeBack(page);
		await page.waitForURL('/');

		// Verify we are back on the homepage
		expect(new URL(page.url()).pathname).toBe('/');
	});

	test('Bug 10: navigate from /profile/settings to /profile/edit -> swipe back -> title slides and tabs do NOT show', async ({ page, context }) => {
		page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));

		await prepareContext(context);
		// 1. Go to home page
		await page.goto('/');
		await waitForHydration(page);

		// Click the burger menu button in the header to open drawer
		const menuBtn = page.locator('header button').first();
		await expect(menuBtn).toBeVisible();
		await menuBtn.click();
		await page.waitForTimeout(300);

		// Click "Settings" link inside drawer/sidebar (filter for the visible mobile drawer instance)
		const settingsLink = page.locator('a[href="/profile/settings"]').filter({ visible: true }).first();
		await expect(settingsLink).toBeVisible();
		await settingsLink.click();
		await page.waitForURL('/profile/settings');

		// Assert title is "Settings"
		const settingsTitle = page.locator('header span.w-full.truncate').first();
		await expect(settingsTitle).toBeVisible();
		const settingsText = await settingsTitle.innerText();
		expect(settingsText.length).toBeGreaterThan(0);

		// Click on "Edit Account" link (which goes to /profile/edit)
		const editLink = page.locator('a[href="/profile/edit"]').first();
		await expect(editLink).toBeVisible();
		await editLink.click();
		await page.waitForURL('/profile/edit');

		// Wait 80ms (middle of the 200ms transition) to capture the animation in-flight
		await page.waitForTimeout(80);

		// Assert that BOTH title elements exist in the DOM during the transition
		const titleLocators = page.locator('header span.w-full.truncate');
		await expect(titleLocators).toHaveCount(2);

		// Get the computed style matrix of the outgoing title (first one)
		const outgoingDiv = page.locator('header span.w-full.truncate').first().locator('..');
		const outgoingMatrix = await outgoingDiv.evaluate(el => window.getComputedStyle(el).transform);
		
		// Get the computed style matrix of the incoming title (second one)
		const incomingDiv = page.locator('header span.w-full.truncate').nth(1).locator('..');
		const incomingMatrix = await incomingDiv.evaluate(el => window.getComputedStyle(el).transform);

		// Extract ty (6th element in matrix(1, 0, 0, 1, 0, ty))
		const matchOut = outgoingMatrix.match(/matrix\([^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*(-?\d+(?:\.\d+)?)\)/);
		const matchIn = incomingMatrix.match(/matrix\([^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*(-?\d+(?:\.\d+)?)\)/);

		expect(matchOut).not.toBeNull();
		expect(matchIn).not.toBeNull();

		const tyOut = parseFloat(matchOut![1]);
		const tyIn = parseFloat(matchIn![1]);

		// At 80ms, outgoing should have moved up (height is 40px, so ty should be between -2px and -38px)
		expect(tyOut).toBeLessThan(-2);
		expect(tyOut).toBeGreaterThan(-38);

		// At 80ms, incoming should have moved up (ty should be between 2px and 38px)
		expect(tyIn).toBeLessThan(38);
		expect(tyIn).toBeGreaterThan(2);

		// Now simulate swipe back from /profile/edit to /profile/settings
		const client = await page.context().newCDPSession(page);
		await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

		const startX = 50;
		const startY = 400;
		const move = async (x: number) => {
			await client.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: [{ x, y: startY, id: 1 }],
				modifiers: 0,
				timestamp: 0
			});
		};

		await client.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [{ x: startX, y: startY, id: 1 }],
			modifiers: 0,
			timestamp: 0
		});
		await page.waitForTimeout(50);

		// Drag right to 200px
		await move(200);
		await page.waitForTimeout(100);

		// Since both source and target are deep pages, tabs must remain at translateY(-100%)
		const tabsTransform = await page.locator('header div.absolute.inset-0.flex.items-center.justify-center').first().evaluate(el => (el as HTMLElement).style.transform);
		expect(tabsTransform).toContain('translateY(-100%)');

		// End the touch
		await client.send('Input.dispatchTouchEvent', {
			type: 'touchEnd',
			touchPoints: [{ x: 200, y: startY, id: 1 }],
			modifiers: 0,
			timestamp: 0
		});

		// Wait 50ms right after touch release (while navigation is in-flight) to check for container burst/down-sinking
		await page.waitForTimeout(50);

		// Get the computed style matrix of the title container (parent of the parent of the span)
		const containerDiv = page.locator('header span.w-full.truncate').first().locator('..').locator('..');
		const containerMatrix = await containerDiv.evaluate(el => window.getComputedStyle(el).transform);

		const matchContainer = containerMatrix.match(/matrix\([^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*(-?\d+(?:\.\d+)?)\)/);
		expect(matchContainer).not.toBeNull();
		const tyContainer = parseFloat(matchContainer![1]);

		// The title container must NOT burst downward; it should remain close to 0px
		expect(tyContainer).toBeLessThan(5);

		// Wait for navigation back to settings
		await page.waitForURL('/profile/settings');
		expect(new URL(page.url()).pathname).toBe('/profile/settings');
	});
});
