import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

test.describe('Profile Settings Drag & Cancel E2E Bugs', () => {
	test.beforeEach(async ({ context }) => {
		await prepareContext(context);
	});

	test('Bug 1, Bug 2 & Bug 3: reproducing drag morph, cancel jump, and drag title sync', async ({ page }) => {
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

		// Check Bug 3: While dragging midway, the titles must shift relative to the gesture progress.
		// If they do not sync, the active title (Edit Profile) translateY remains 0%, and target title is at -100%/100%.
		const dragTitleStates = await page.evaluate(() => {
			const els = Array.from(document.querySelectorAll('div[style*="translateY"]'));
			return els.map(el => {
				const style = el.getAttribute('style') || '';
				const text = el.textContent?.trim() || '';
				const match = style.match(/translateY\(([-.\d]+)%\)/);
				const y = match ? parseFloat(match[1]) : null;
				return { text, y };
			});
		});

		console.log('Dragging title states (CDP):', dragTitleStates);

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

		// Assert Bug 3: Title must move during active dragging (translateY must not be exactly 0% for current title)
		const dragCurrentTitle = dragTitleStates.find(t => t.text === '编辑资料');
		expect(dragCurrentTitle, 'Current title element must exist in DOM during drag').toBeDefined();
		expect(Math.abs(dragCurrentTitle?.y ?? 0), 'Current title must shift away from 0% in sync with drag gesture').toBeGreaterThan(10);

		// Assert Bug 2: Title must not show the back target title during cancel settle
		const currentTitleEl = titleStates.find(t => t.text === '编辑资料');
		const targetTitleEl = titleStates.find(t => t.text === '账号设置');

		expect(currentTitleEl, 'Current title element must exist in DOM during cancel').toBeDefined();
		expect(Math.abs(currentTitleEl?.y ?? 100), 'Current title must roll back close to 0%').toBeLessThan(50);

		if (targetTitleEl) {
			expect(Math.abs(targetTitleEl.y ?? 0), 'Target title must retreat back to off-screen').toBeGreaterThan(50);
		}
	});
});
