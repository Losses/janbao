import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

test.describe('Tab Swipe Hamburger and Tab Jump regression test', () => {
	test.beforeEach(async ({ context }) => {
		await prepareContext(context);
	});

	test('should not morph hamburger or hide tabs during horizontal tab swipe', async ({ page }) => {
		// 1. Enter homepage / (which has tabs)
		await page.goto('/');
		await waitForHydration(page);
		await page.waitForTimeout(500);

		// 2. Start horizontal swipe-left gesture (from right to left) to go to the next tab
		const client = await page.context().newCDPSession(page);
		await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

		const width = page.viewportSize()?.width ?? 393;
		const startX = Math.round(width * 0.8);
		const y = 400;

		// Touch start
		await client.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [{ x: startX, y, id: 10 }],
			modifiers: 0,
			timestamp: 0
		});

		// Drag left halfway to switch tabs (dragOffset around -100px)
		await client.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ x: startX - 100, y, id: 10 }],
			modifiers: 0,
			timestamp: 0
		});

		// Wait briefly to let the swipe state publish and render
		await page.waitForTimeout(150);

		// 3. Capture header status mid-drag
		const midDragStatus = await page.evaluate(() => {
			const header = document.querySelector('header');
			if (!header) return { error: 'Header not found' };

			// Find the BurgerArrowIcon's mask group to check rotation
			const maskG = header.querySelector('svg mask g') as HTMLElement | null;
			const groupTransform = maskG ? maskG.style.transform : null;

			// Find the wrapper of MobileTabBar that receives rootLayerStyle (translateY)
			const tabsNav = header.querySelector('nav[aria-label]');
			const tabsWrapper = tabsNav ? tabsNav.parentElement : null;
			const tabsTransform = tabsWrapper ? tabsWrapper.style.transform : null;

			return {
				error: null,
				groupTransform,
				tabsTransform
			};
		});

		console.log('Mid-drag status:', midDragStatus);

		// End touch drag
		await client.send('Input.dispatchTouchEvent', {
			type: 'touchEnd',
			touchPoints: [{ x: startX - 100, y, id: 10 }],
			modifiers: 0,
			timestamp: 0
		});
		await client.detach();

		// Assertions:
		// Mid-drag, morph must remain 1 (since we are on a tab page).
		// So the mask group rotation must not rotate towards 180deg (it must stay at rotate(0deg) or close to it).
		// And the tabs wrapper translateY must stay at translateY(0%) (it must not be -100%).
		expect(midDragStatus.error).toBeNull();
		
		// We expect the hamburger to stay a hamburger (rotate(0deg))
		expect(midDragStatus.groupTransform).toContain('rotate(0deg)');
		expect(midDragStatus.tabsTransform).toContain('translateY(0%)');
	});
});
