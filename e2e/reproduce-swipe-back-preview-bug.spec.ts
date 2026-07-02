import { test, expect } from '@playwright/test';
import {
	prepareContext,
	waitForHydration,
	openSidebarAndGoto
} from './helpers';

test.describe('Swipe Back Preview Bug from Bookmarks to Inbox', () => {
	test.beforeEach(async ({ context }) => {
		await prepareContext(context);
	});

	test('should reproduce missing title and height/layout mismatch in preview', async ({ page }) => {
		// 1. Enter /messages/inbox (mobile view)
		await page.goto('/messages/inbox');
		await waitForHydration(page);
		await page.waitForTimeout(500);

		// 2. Open sidebar and go to /bookmarks
		await openSidebarAndGoto(page, '/bookmarks');
		await page.waitForURL('/bookmarks');
		await waitForHydration(page);
		await page.waitForTimeout(500);

		// Verify we are at /bookmarks
		expect(new URL(page.url()).pathname).toBe('/bookmarks');

		// 3. Start swipe-back gesture via CDP session
		const client = await page.context().newCDPSession(page);
		await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

		// Start touch drag at x=50, y=400 (inside the active area)
		await client.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [{ x: 50, y: 400, id: 3 }],
			modifiers: 0,
			timestamp: 0
		});

		// Drag right to x=250 to reveal the preview pane
		await client.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ x: 250, y: 400, id: 3 }],
			modifiers: 0,
			timestamp: 0
		});

		// Wait briefly to let the preview panel render and styles apply
		await page.waitForTimeout(300);

		// 4. Assert preview state (reproducing the bug)
		const previewMetrics = await page.evaluate(() => {
			const previewEl = document.querySelector('section[data-preview-tab="messages"]') as HTMLElement | null;
			if (!previewEl) {
				return { error: 'Preview element section[data-preview-tab="messages"] not found' };
			}

			const titleEl = previewEl.querySelector('.page-title') as HTMLElement | null;
			const gplCardEl = previewEl.querySelector('.gpl-card') as HTMLElement | null;
			const htmlHasFixedViewport = document.documentElement.classList.contains('fixed-viewport');

			const computedStyle = window.getComputedStyle(previewEl);
			const titleStyle = titleEl ? window.getComputedStyle(titleEl) : null;
			
			const firstChild = previewEl.firstElementChild as HTMLElement | null;

			return {
				error: null,
				htmlHasFixedViewport,
				previewHeight: computedStyle.height,
				previewOverflowY: computedStyle.overflowY,
				hasGplCard: !!gplCardEl,
				hasTitle: !!titleEl,
				titleDisplay: titleStyle ? titleStyle.display : null,
				titleText: titleEl ? titleEl.textContent?.trim() : null,
				// Padding/Width measurements
				paddingLeft: computedStyle.paddingLeft,
				paddingRight: computedStyle.paddingRight,
				paddingTop: computedStyle.paddingTop,
				paddingBottom: computedStyle.paddingBottom,
				rect: previewEl.getBoundingClientRect().toJSON(),
				childRect: firstChild ? firstChild.getBoundingClientRect().toJSON() : null
			};
		});

		console.log('Preview metrics captured during swipe-back gesture:', previewMetrics);

		expect(previewMetrics.error).toBeNull();
		expect(previewMetrics.htmlHasFixedViewport).toBe(true);
		expect(previewMetrics.hasGplCard).toBe(false);
		expect(previewMetrics.hasTitle).toBe(true);
		expect(previewMetrics.titleDisplay).not.toBe('none');

		// 5. Complete swipe-back gesture
		await client.send('Input.dispatchTouchEvent', {
			type: 'touchEnd',
			touchPoints: [{ x: 250, y: 400, id: 3 }],
			modifiers: 0,
			timestamp: 0
		});
		await client.detach();

		// 6. Wait for landing and assert landed page state
		await page.waitForURL('/messages/inbox');
		await page.waitForTimeout(500);

		const landedMetrics = await page.evaluate(() => {
			const landedEl = document.querySelector('section[data-tab-panel="messages"]') as HTMLElement | null;
			if (!landedEl) {
				return { error: 'Landed element section[data-tab-panel="messages"] not found' };
			}
			const titleEl = landedEl.querySelector('.page-title') as HTMLElement | null;
			const htmlHasFixedViewport = document.documentElement.classList.contains('fixed-viewport');
			const computedStyle = window.getComputedStyle(landedEl);
			const titleStyle = titleEl ? window.getComputedStyle(titleEl) : null;
			
			const firstChild = landedEl.firstElementChild as HTMLElement | null;

			return {
				error: null,
				htmlHasFixedViewport,
				hasTitle: !!titleEl,
				titleDisplay: titleStyle ? titleStyle.display : null,
				titleText: titleEl ? titleEl.textContent?.trim() : null,
				// Padding/Width measurements
				paddingLeft: computedStyle.paddingLeft,
				paddingRight: computedStyle.paddingRight,
				paddingTop: computedStyle.paddingTop,
				paddingBottom: computedStyle.paddingBottom,
				rect: landedEl.getBoundingClientRect().toJSON(),
				childRect: firstChild ? firstChild.getBoundingClientRect().toJSON() : null
			};
		});

		console.log('Landed metrics captured on /messages/inbox:', landedMetrics);

		// Assert that fixed-viewport is present after landing (the pager acquires it)
		expect(landedMetrics.htmlHasFixedViewport).toBe(true);
		expect(landedMetrics.hasTitle).toBe(true);
		expect(landedMetrics.titleDisplay).not.toBe('none');

		// Assert that preview layout dimensions (paddings, widths, offsets) match landed page perfectly
		expect(previewMetrics.paddingLeft).toBe(landedMetrics.paddingLeft);
		expect(previewMetrics.paddingRight).toBe(landedMetrics.paddingRight);
		expect(previewMetrics.paddingBottom).toBe(landedMetrics.paddingBottom);
		expect(previewMetrics.childRect?.width).toBe(landedMetrics.childRect?.width);
		expect(previewMetrics.childRect?.y).toBe(landedMetrics.childRect?.y);
	});
});
