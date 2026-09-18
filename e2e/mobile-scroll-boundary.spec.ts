import { test, expect } from '@playwright/test';
import { waitForHydration } from './helpers';

test('direct tap in an empty editor does not jump before the keyboard opens', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	const pane = page.locator('[data-tab-panel="discussions"]');
	await pane.evaluate((el) => {
		const editor = document.createElement('div');
		editor.id = 'direct-tap-editor';
		editor.contentEditable = 'true';
		editor.style.cssText = 'height: 1800px; background: white;';
		el.prepend(editor);
		el.scrollTop = 0;
	});
	await page.locator('#direct-tap-editor').tap({ position: { x: 100, y: 100 } });
	await expect(page.locator('#direct-tap-editor')).toBeFocused();
	await page.evaluate(() => new Promise<void>((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	}));
	await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(0);
});

test('application shell cannot become a second scroll container', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	const pane = page.locator('[data-tab-panel="discussions"]');
	const outerScroll = await pane.evaluate((el) => {
		const shell = el.closest('.app-shell') as HTMLElement;
		// Force overflow to prove the shell cannot be scrolled by focus/scrollIntoView.
		const overflow = document.createElement('div');
		overflow.style.cssText = 'position: absolute; top: 2000px; height: 100px';
		shell.append(overflow);
		shell.scrollTop = 200;
		const result = shell.scrollTop;
		overflow.remove();
		return result;
	});
	expect(outerScroll).toBe(0);
});
