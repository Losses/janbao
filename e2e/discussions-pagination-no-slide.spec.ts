import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration, capturePagerSwitch } from './helpers';

// DV20 /discussions/pN migration: `/discussions/pN` is a (tabs) child rendered
// through the persistent NavPipelineTabHost pager. A within-tab pagination nav
// (`/discussions/pN` -> `/`, both the discussions tab) must NOT play a tab-
// switch slide: the panel does not change, only the page content does, so the
// pager track stays at rest. The orchestrator's tab-click-exit classifier
// suppresses the slide via `getCurrentTabIndex(from) === getCurrentTabIndex(to)`
// gated on `getRouteData(from).tag === 'tab'` (a deep route that shares the
// tab's index, e.g. `/discussion/<id>` -> `/`, still plays its slide).

test.describe('within-tab pagination nav does not slide the pager', () => {
	test.beforeEach(async ({ context }) => {
		await prepareContext(context);
	});

	test('/discussions/p2 -> / (same discussions tab) keeps the pager track at rest', async ({
		page
	}) => {
		await page.goto('/discussions/p2');
		await waitForHydration(page);
		await page.waitForTimeout(300);
		const capture = await capturePagerSwitch(page, async () => {
			// Tap the discussions tab (href="/"): a within-tab pagination nav
			// (page 2 -> page 1 of the discussions list).
			await page.locator('a[data-tab-nav][href="/"]').click();
			await page.waitForURL('/');
		});
		expect(capture.animated, 'within-tab pagination must not slide the pager track').toBe(false);
		expect(capture.firstPanel, 'the discussions panel stays put').toBe('discussions');
		expect(capture.lastPanel).toBe('discussions');
	});
});
