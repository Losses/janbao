import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration, clickDiscussion } from './helpers';

/**
 * Desktop→mobile resize regression coverage for NavPipelineHost.
 *
 * The pager initialises `snapIndex = isEntering ? 0 : ACTIVE`. On a list→thread
 * SPA navigation `navStore.direction` is `'forward'` and the stack is
 * `['/', '/discussion/x']`, so `shouldAnimateEnter()` is true and `snapIndex`
 * starts at 0 - the first frame of the mobile slide-in. The one-frame `enterRaf`
 * that advances it back to ACTIVE (centre) is gated `if (isEntering && isMobile)`,
 * so on a DESKTOP mount it never runs and `snapIndex` is stranded at 0. Desktop
 * hides this (the track is `display:block; transform:none`, snapIndex unused);
 * resizing into mobile then rests the pager on panel 0 - the LEFT / discussions
 * list ("homepage") - pushing the thread off-screen. Hard deep-links are immune
 * (`beforeNavigate` doesn't fire on load → direction stays `'none'` → snapIndex
 * starts at ACTIVE), so the reproduction MUST go through an in-app list→thread
 * navigation at desktop size.
 */

const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

/**
 * The thread's centre panel (`.detail-scroll-pane`) is the panel the user was
 * reading on desktop. After a resize into mobile it MUST remain in the viewport.
 * Pre-fix: snapIndex=0 → translateX(0%) → the centre panel sits at left≈vw
 * (off-screen) while the left list panel takes the viewport.
 */
async function centrePanelLeft(page: import('@playwright/test').Page): Promise<number> {
	return page.evaluate(() => {
		const el = document.querySelector('.detail-scroll-pane');
		return el ? Math.round(el.getBoundingClientRect().left) : Number.NaN;
	});
}

test('thread stays centred after a desktop list→thread SPA nav + resize to mobile', async ({
	page
}) => {
	// 1. Land on the list at DESKTOP (overrides the Pixel 5 default).
	await page.setViewportSize(DESKTOP_VIEWPORT);
	await page.goto('/');
	await waitForHydration(page);

	// 2. In-app list→thread navigation at desktop: arms the stale snapIndex=0.
	await clickDiscussion(page, 0);
	await page.waitForURL(/\/discussion\//);

	// 3. Shrink to mobile - this is where the bug manifests.
	await page.setViewportSize(MOBILE_VIEWPORT);

	// 4. The centre panel must re-enter / stay in the viewport. Pre-fix it sits
	//    off-screen at left≈vw while the homepage list is shown instead.
	await page.waitForFunction(
		() => {
			const el = document.querySelector('.detail-scroll-pane');
			if (!el) return false;
			const left = el.getBoundingClientRect().left;
			return left >= -1 && left < window.innerWidth / 2;
		},
		{ timeout: 5000 }
	);
	const left = await centrePanelLeft(page);
	expect(left, `centre panel must be in the viewport (left≈0), got left=${left}`).toBeLessThan(
		MOBILE_VIEWPORT.width / 2
	);
});

test('hard deep-link to a thread is immune (sanity for the reproduction path)', async ({ page }) => {
	// A full load never fires beforeNavigate, so direction stays 'none',
	// shouldAnimateEnter() is false, and snapIndex starts at ACTIVE. Resizing to
	// mobile must therefore leave the thread centred - guards against a "fix" that
	// happens to pass by accident on the deep-link path while missing the SPA path.
	await page.setViewportSize(DESKTOP_VIEWPORT);
	await page.goto('/');
	await waitForHydration(page);
	await clickDiscussion(page, 0);
	await page.waitForURL(/\/discussion\//);

	await page.reload();
	await waitForHydration(page);

	await page.setViewportSize(MOBILE_VIEWPORT);
	await page.waitForFunction(
		() => {
			const el = document.querySelector('.detail-scroll-pane');
			if (!el) return false;
			const left = el.getBoundingClientRect().left;
			return left >= -1 && left < window.innerWidth / 2;
		},
		{ timeout: 5000 }
	);
	const left = await centrePanelLeft(page);
	expect(left, `deep-link thread must stay centred after resize, got left=${left}`).toBeLessThan(
		MOBILE_VIEWPORT.width / 2
	);
});
