import { test, expect } from '@playwright/test';
import { waitForHydration } from './helpers';

for (const surface of ['list', 'thread']) {
	test(`${surface}: cache capture preserves native smooth scrolling`, async ({ page }) => {
		await page.goto('/');
		await waitForHydration(page);
		if (surface === 'thread') {
			await page.locator('[data-tab-panel="discussions"] a[href^="/discussion/"]').first().click();
			await page.waitForURL(/\/discussion\//);
		}
		const pane = page.locator(
			surface === 'thread' ? '.detail-scroll-pane' : '[data-tab-panel="discussions"]'
		);
		// Supply enough scroll range even when the local database has a short list.
		await pane.evaluate((el) => {
			const spacer = document.createElement('div');
			spacer.style.height = '4000px';
			el.append(spacer);
			el.scrollTo({ top: 0, behavior: 'instant' });
		});
		await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(0);
		await pane.evaluate((el) => el.scrollTo({ top: 1500, behavior: 'smooth' }));
		await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(1500);
		await pane.evaluate((el) => el.scrollTo({ top: 300, behavior: 'smooth' }));
		await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(300);
	});
}
