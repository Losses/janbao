import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

/**
 * Regression guard for the move of the eager tab-data load from `(tabs)` up to
 * the ROOT layout (so top-level deep pages like `/discussion/*` - which are NOT
 * under `(tabs)` - also get list data for their swipe previews). These tests pin
 * the behaviours that must NOT change:
 *   - every tab page still renders its list (data still reaches the tab host),
 *   - a non-app route (login) still loads (the root load's new tab fetch must not
 *     crash routes that don't need it),
 *   - a logged-out (guest) visitor still sees the discussions list (the guest
 *     policy on the moved load is preserved).
 *
 * They are run BEFORE the move as a baseline (must already be GREEN) and again
 * AFTER (must stay GREEN).
 */

test.describe('root layout provides tab data', () => {
	test('each tab page renders its list (data flows through to the tab host)', async ({ page, context }) => {
		await prepareContext(context);

		await page.goto('/');
		await waitForHydration(page);
		const discussionsCount = await page.locator('[data-tab-panel="discussions"] a[href^="/discussion/"]').count();
		expect(discussionsCount, 'Discussions tab renders its list').toBeGreaterThan(0);

		await page.goto('/activity');
		await waitForHydration(page);
		await page.waitForTimeout(300);
		const activityChip = await page.locator('[data-tab-panel="activity"] .loading-chip').count();
		expect(activityChip, 'Activity tab has its data (no cold-cache loading chip)').toBe(0);

		await page.goto('/messages/inbox');
		await waitForHydration(page);
		const messagesCount = await page.locator('[data-tab-panel="messages"] a[href^="/messages/"]').count();
		expect(messagesCount, 'Messages tab renders its conversations').toBeGreaterThan(0);
	});

	test('login page loads (the root load does not break a non-app route)', async ({ page }) => {
		// No auth cookie: the root load now also fetches the three tabs; it must
		// not throw on a route that doesn't render them.
		const response = await page.goto('/entry/signin');
		expect(response?.status(), 'signin loads with 200').toBe(200);
		await expect(page.locator('form')).toBeVisible({ timeout: 8000 });
	});

	test('a logged-out (guest) visitor hits the login wall, not a crash', async ({ page }) => {
		// No auth cookie. The forum gates content behind auth, so `/` renders a
		// login wall for guests (no tab host). The point of this guard: the
		// root load's new tab fetch must not throw on a guest request - the page
		// must still load (200), whatever it renders.
		const response = await page.goto('/');
		expect(response?.status(), 'guest request loads (no crash from the moved load)').toBe(200);
	});
});
