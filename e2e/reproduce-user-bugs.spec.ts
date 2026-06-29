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
});
