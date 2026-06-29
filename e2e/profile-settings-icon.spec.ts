import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

test.describe('Profile Settings Drag & Cancel E2E Bugs', () => {
	test.beforeEach(async ({ context }) => {
		await prepareContext(context);
	});

	test('Bug 1 & Bug 2: reproducing drag morph and cancel jump', async ({ page }) => {
		await page.goto('/profile/settings');
		await waitForHydration(page);

		// Click to Edit Profile
		await page.locator('main a[href="/profile/edit"]').first().click();
		await page.waitForURL('/profile/edit');
		await page.waitForTimeout(500);

		// Start CDP session for real touch drag
		const client = await page.context().newCDPSession(page);
		await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

		const width = page.viewportSize()?.width ?? 393;
		const startX = Math.round(width * 0.3);
		const midX = startX + 150;
		const endX = startX + 10;
		const y = 400;

		const dispatch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, state: string) =>
			client.send('Input.dispatchTouchEvent', {
				type,
				touchPoints: [{ state, x, y, id: 1 }] as unknown as never,
				modifiers: 0,
				timestamp: 0
			});

		// 1. Start drag
		await dispatch('touchStart', startX, 'touchPressed');
		
		// Move to midway (midX)
		const steps = 10;
		for (let i = 1; i <= steps; i++) {
			const x = Math.round(startX + (midX - startX) * (i / steps));
			await dispatch('touchMove', x, 'touchMoved');
			await page.waitForTimeout(16);
		}

		// Check Bug 1: While dragging midway, check if the icon progressed towards hamburger (progress < 1)
		const style = await page.locator('button[aria-label] svg g').first().getAttribute('style');
		const match = style ? style.match(/rotate\(([\d.]+)deg\)/) : null;
		const progressDuringDrag = match ? parseFloat(match[1]) / 180 : null;

		console.log('Progress during dragging (CDP):', progressDuringDrag);

		// Now pull back to cancel (endX)
		for (let i = 1; i <= steps; i++) {
			const x = Math.round(midX + (endX - midX) * (i / steps));
			await dispatch('touchMove', x, 'touchMoved');
			await page.waitForTimeout(16);
		}

		// Release touch to trigger cancel settle
		await dispatch('touchEnd', endX, 'touchReleased');
		await client.detach();

		// Wait a tiny bit for transition to start
		await page.waitForTimeout(50);

		// Check Bug 2: During cancel transition, check titles
		const titleStates = await page.evaluate(() => {
			const els = Array.from(document.querySelectorAll('div[style*="translateY"]'));
			return els.map(el => {
				const style = el.getAttribute('style') || '';
				const text = el.textContent?.trim() || '';
				const match = style.match(/translateY\(([-.\d]+)%\)/);
				const y = match ? parseFloat(match[1]) : null;
				return { text, y };
			});
		});

		console.log('Settle titles captured states (CDP):', titleStates);

		// Assert Bug 1: Icon must not morph to hamburger during dragging
		expect(progressDuringDrag, 'Icon progress must remain close to 1 (arrow) during deep-to-deep drag').toBeGreaterThan(0.95);

		// Assert Bug 2: Title must not show the back target title during cancel settle
		const activeTitle = titleStates.find(t => t.y !== null && Math.abs(t.y) < 50);
		expect(activeTitle?.text, 'Active title during cancel transition must be "编辑资料" (current), not "设置"').not.toBe('设置');
	});
});
