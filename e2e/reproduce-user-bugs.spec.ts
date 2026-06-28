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

	test('Bug 3: thread -> Message tab click -> swipe back directly returns to thread, skipping Activity', async ({ page }) => {
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

		// 4. Swipe back (left-to-right gesture) on Messages tab
		await swipeBack(page);
		
		// Wait for navigation
		await page.waitForTimeout(1000);
		const landedPath = new URL(page.url()).pathname;
		console.log('Landed path for Bug 3:', landedPath);
		
		// Assert that it resolved the conflict and landed on the spatial neighbor /activity
		expect(landedPath).toBe('/activity');
	});
});
