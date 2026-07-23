import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration, clickDiscussion } from './helpers';

/**
 * Desktop→mobile resize regression coverage for NavPipelineHost.
 *
 * The enter animation gate is the `shouldEnter` $derived.by in
 * NavPipelineHost.svelte (forward direction AND the stack's previous pathname
 * === resolvedLeftHref). On a list→thread SPA navigation `navStore.direction`
 * is `'forward'` and the stack is `['/', '/discussion/x']`, so `shouldEnter` is
 * true and `orchestrator.playEnterAnimation()` seeds the track at
 * translateX(0px) on the first mobile frame and slides to its resting
 * translateX(-33.333%). The play is gated on a mobile check inside the
 * orchestrator, so on a DESKTOP mount it never runs and the track rests at
 * translateX(0px) = panel 0 (the LEFT / discussions list, "homepage"),
 * pushing the thread off-screen. Desktop hides this (the track is
 * `display:block` at desktop); resizing into mobile then leaves the pager
 * resting on panel 0. Hard deep-links are immune (`beforeNavigate` doesn't fire
 * on load → direction stays `'none'` → shouldEnter is false → the track seeds
 * at its resting -33.333% with the centre panel in view), so the reproduction
 * MUST go through an in-app list→thread navigation at desktop size.
 */

const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

/**
 * The thread's centre panel (`.detail-scroll-pane`) is the panel the user was
 * reading on desktop. After a resize into mobile it MUST remain in the viewport.
 * The defect: track resting at translateX(0px) → the centre panel sits at
 * left≈vw (off-screen) while the left list panel takes the viewport.
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

	// 2. In-app list→thread navigation at desktop: arms the resting translateX(0px)
	//    (the enter-animation seeds the track at 0px and the desktop mount never
	//    slides it to -33.333%).
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
	// shouldEnter is false, and the track seeds at its resting translateX(-33.333%)
	// with the centre panel in view. Resizing to mobile must therefore leave the
	// thread centred - guards against a "fix" that happens to pass by accident on
	// the deep-link path while missing the SPA path.
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
