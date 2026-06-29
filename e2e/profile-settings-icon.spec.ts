import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

test.describe('Profile Settings Icon Morph Bug', () => {
	test.beforeEach(async ({ context }) => {
		await prepareContext(context);
	});

	test('should not show hamburger icon when navigating from profile settings to edit profile and back', async ({ page }) => {
		// 1. Go to profile settings page
		await page.goto('/profile/settings');
		await waitForHydration(page);

		// Helper to extract progress from the icon SVG group transform rotate
		const getIconProgress = async () => {
			const style = await page.locator('button[aria-label] svg g').first().getAttribute('style');
			if (!style) return null;
			const match = style.match(/rotate\(([\d.]+)deg\)/);
			return match ? parseFloat(match[1]) / 180 : null;
		};

		// The icon should start as a back arrow (progress = 1)
		const initialProgress = await getIconProgress();
		expect(initialProgress).toBeCloseTo(1, 1);

		// Start tracking style changes of the icon during navigation
		await page.evaluate(() => {
			(window as any).progressHistory = [];
			const el = document.querySelector('button[aria-label] svg g');
			if (el) {
				const observer = new MutationObserver(() => {
					const style = el.getAttribute('style');
					if (style) {
						const match = style.match(/rotate\(([\d.]+)deg\)/);
						if (match) {
							(window as any).progressHistory.push(parseFloat(match[1]) / 180);
						}
					}
				});
				observer.observe(el, { attributes: true, attributeFilter: ['style'] });
				(window as any)._observer = observer;
			}
		});

		// 2. Click "Edit Profile" link (href="/profile/edit") in main content
		await page.locator('main a[href="/profile/edit"]').first().click();
		await page.waitForURL('/profile/edit');

		// Wait for settle animation to finish
		await page.waitForTimeout(500);

		// Get tracked progress history
		const forwardHistory = await page.evaluate(() => {
			const h = (window as any).progressHistory || [];
			if ((window as any)._observer) {
				(window as any)._observer.disconnect();
			}
			return h;
		});

		console.log('Forward navigation icon progress history:', forwardHistory);

		// Throughout the navigation, since we are going from a deep page (no tabs)
		// to another deep page (no tabs), the icon should NEVER morph to hamburger (progress = 0).
		// We allow some sub-pixel/rounding floating point issues, but it shouldn't dip near 0.
		for (const p of forwardHistory) {
			expect(p, 'Icon progress should not dip to hamburger (0) during deep-to-deep navigation').toBeGreaterThan(0.1);
		}

		// Now test the return journey: from /profile/edit back to /profile/settings
		// Re-initialize tracking
		await page.evaluate(() => {
			(window as any).progressHistory = [];
			const el = document.querySelector('button[aria-label] svg g');
			if (el) {
				const observer = new MutationObserver(() => {
					const style = el.getAttribute('style');
					if (style) {
						const match = style.match(/rotate\(([\d.]+)deg\)/);
						if (match) {
							(window as any).progressHistory.push(parseFloat(match[1]) / 180);
						}
					}
				});
				observer.observe(el, { attributes: true, attributeFilter: ['style'] });
				(window as any)._observer = observer;
			}
		});

		// Click the back button (it is a deep page, so the left button is back)
		await page.locator('button[aria-label]').first().click();
		await page.waitForURL('/profile/settings');

		// Wait for settle animation to finish
		await page.waitForTimeout(500);

		const backwardHistory = await page.evaluate(() => {
			const h = (window as any).progressHistory || [];
			if ((window as any)._observer) {
				(window as any)._observer.disconnect();
			}
			return h;
		});

		console.log('Backward navigation icon progress history:', backwardHistory);

		for (const p of backwardHistory) {
			expect(p, 'Icon progress should not dip to hamburger (0) during backward deep-to-deep navigation').toBeGreaterThan(0.1);
		}
	});
});
