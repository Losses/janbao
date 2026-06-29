import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

test.describe('Hamburger to Arrow back animation stutter bug', () => {
	test.beforeEach(async ({ context }) => {
		await prepareContext(context);
	});

	test('should reproduce animation stutter / sudden jump on back navigation', async ({ page }) => {
		// 1. Enter /activity (mobile view)
		await page.goto('/activity');
		await waitForHydration(page);
		await page.waitForTimeout(500);

		// 2. Click hamburger menu to open drawer
		const menuBtn = page.locator('header button').first();
		await expect(menuBtn).toBeVisible();
		await menuBtn.click();
		await page.waitForTimeout(300);

		// 3. Click settings in drawer
		const settingsLink = page.locator('a[href="/profile/settings"]').filter({ visible: true }).first();
		await expect(settingsLink).toBeVisible();
		await settingsLink.click();
		await page.waitForURL('/profile/settings');
		await page.waitForTimeout(500);

		// Now we are at /profile/settings. Let's record transition or check styles on clicking back.
		// Click back button (first button in header)
		const backBtn = page.locator('header button').first();
		await expect(backBtn).toBeVisible();

		// Record states during/after back transition
		const states: any[] = [];
		const monitor = async () => {
			for (let i = 0; i < 20; i++) {
				const state = await page.evaluate(() => {
					const header = document.querySelector('header');
					if (!header) return null;
					const titleSpans = Array.from(header.querySelectorAll('span.w-full.truncate'));
					const titleTexts = titleSpans.map(s => s.textContent?.trim());
					const transform = header.querySelector('.flex.w-\\[200\\%\\]')?.getAttribute('style') || '';
					const rootLayer = header.querySelector('div[style*="translateY"]')?.getAttribute('style') || '';
					return {
						titleTexts,
						transform,
						rootLayer
					};
				});
				states.push(state);
				await page.waitForTimeout(20);
			}
		};

		const navPromise = backBtn.click();
		await monitor();
		await navPromise;

		// Let's wait for navigation to settle
		await page.waitForURL('/activity');
		await page.waitForTimeout(500);

		// Assertions:
		// 1. During the transition, we must see both titles in DOM (outgoing "账号设置" and incoming "")
		const transitionFrame = states.find(s => s && s.titleTexts.length === 2);
		expect(transitionFrame, 'Must have a transition frame where both outgoing and incoming titles exist').toBeDefined();
		expect(transitionFrame.titleTexts).toContain('账号设置');
		expect(transitionFrame.titleTexts).toContain('');

		// 2. The transition styles must not be disabled during this slide (no transition: none on rootLayer)
		expect(transitionFrame.rootLayer).toContain('transition: transform 200ms ease-out');
	});
});
