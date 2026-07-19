import { test, expect, type Page } from '@playwright/test';
import { prepareContext, waitForHydration, openSidebarAndGoto } from './helpers';

/**
 * REGRESSION (auditor R88-B): the MobileTabBar must stay clickable at rest on
 * a tab root when `navStore.backTarget` is a DEEP page.
 *
 * Reproduction: land on `/`, then drive two deep pages via in-app links so
 * tab-0's history stack accumulates deep entries (`[/, /bookmarks, /profile]`).
 * A subsequent SPA nav to `/` resolves `hopForHref('/') === 'push'` (the
 * previous history entry is `/bookmarks`, not `/`), so the navigation is NOT
 * a popstate and the root layout's `handleBeforeNavigate` pushes `/` onto
 * stack 0, leaving `navStore.backTarget === '/profile'` (a deep,
 * pill-target 'active' route).
 *
 * In `Header.svelte` the at-rest fallback for `tabsIn` must read
 * `currentHasTabs`, NOT `targetHasTabs`. At `/` with a deep backTarget,
 * `currentHasTabs=true` (the route the user is on is a tab root) while
 * `targetHasTabs=false` (the backTarget is a deep page). Reading
 * `targetHasTabs` at rest drives `rootLayerStyle`'s
 * `pointer-events: ${morph > 0.5 && tabsIn ? 'auto' : 'none'}` to `'none'`,
 * which makes the MobileTabBar unclickable whenever the back-target is deep.
 *
 * Triggering the `/profile -> /` nav: a real MobileTabBar tab tap is hidden
 * on a deep page (the tab layer is `translateY(-100%); pointer-events: none`
 * whenever `currentHasTabs=false`). The dev-only `__e2eGoto` hook fires the
 * SAME SvelteKit `beforeNavigate` the orchestrator's commit goto re-dispatches
 * after intercepting a real tab tap, so the post-landing navStore state is
 * identical to the user-facing scenario (verified here via `__navStore`).
 *
 * The regression assertion is behavioural: tap the Activity tab on `/` and
 * assert the URL changes. With the bug the click is a no-op (the tab layer
 * swallows the hit-test), so `waitForURL('/activity')` times out.
 */

interface NavStoreWindow extends Window {
	__navStore?: { backTarget: string };
}

async function backTarget(page: Page): Promise<string | undefined> {
	return page.evaluate(() => (window as unknown as NavStoreWindow).__navStore?.backTarget);
}

async function rootLayerPointerEvents(page: Page): Promise<string> {
	// The tab layer wrapper is the first child of the title-slot container
	// (`header div.relative.h-10.flex-1 > div`). Reading its computed
	// `pointer-events` directly probes the buggy style binding.
	return page.evaluate(() => {
		const nodes = document.querySelectorAll('header div.relative.h-10.flex-1 > div');
		const root = nodes[0] as HTMLElement | undefined;
		if (!root) return 'missing';
		return getComputedStyle(root).pointerEvents;
	});
}

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

test('MobileTabBar stays clickable on `/` with a deep backTarget (R88-B regression)', async ({
	page
}) => {
	// 1. Land on `/`.
	await page.goto('/');
	await waitForHydration(page);

	// 2. In-app nav to `/bookmarks` (drawer link equivalent). Same-tab push:
	//    stacks[0] = ['/', '/bookmarks'].
	await openSidebarAndGoto(page, '/bookmarks');
	await page.waitForTimeout(200);

	// 3. In-app nav to `/profile/settings` (drawer link equivalent). Same-tab
	//    push: stacks[0] = ['/', '/bookmarks', '/profile/settings'].
	await openSidebarAndGoto(page, '/profile/settings');
	await page.waitForTimeout(200);

	// 4. Navigate to `/`. `hopForHref('/')` === 'push' (the previous entry is
	//    `/bookmarks`), so the orchestrator's re-dispatch goes through
	//    `handleBeforeNavigate` (push, NOT switchTab), leaving
	//    `navStore.backTarget === '/profile/settings'` (a deep page).
	await openSidebarAndGoto(page, '/');
	await page.waitForTimeout(400);

	// 5. Precondition: the bug state. At `/` with a deep backTarget,
	//    `currentHasTabs=true` and `targetHasTabs=false`.
	const bt = await backTarget(page);
	expect(bt, 'precondition: backTarget must be the deep page').toBe('/profile/settings');

	// 6. Behavioural assertion: tap the Activity tab on the MobileTabBar.
	//    With the bug (`tabsIn = targetHasTabs = false` on `/`), the
	//    rootLayerStyle wrapper has `pointer-events: none`, so the click is a
	//    no-op and the URL never leaves `/`. With the fix
	//    (`tabsIn = currentHasTabs = true`), the tab is clickable and the
	//    navigation lands on `/activity`.
	await page.locator('a[data-tab-nav][href="/activity"]').click();
	await page.waitForURL('/activity', { timeout: 6000 });
	expect(new URL(page.url()).pathname).toBe('/activity');
});

test('rootLayerStyle wrapper has pointer-events: auto at rest on `/` with a deep backTarget', async ({
	page
}) => {
	// Same chain, structural assertion: read the tab layer wrapper's computed
	// style. With the bug it is `none`; with the fix it is `auto`. Documents
	// the proximate cause of the behavioural regression above.
	await page.goto('/');
	await waitForHydration(page);
	await openSidebarAndGoto(page, '/bookmarks');
	await openSidebarAndGoto(page, '/profile/settings');
	await openSidebarAndGoto(page, '/');
	await page.waitForTimeout(400);

	const bt = await backTarget(page);
	expect(bt, 'precondition: backTarget must be the deep page').toBe('/profile/settings');

	const pe = await rootLayerPointerEvents(page);
	expect(pe, 'tab layer wrapper must be interactive at rest on a tab root').toBe('auto');
});
