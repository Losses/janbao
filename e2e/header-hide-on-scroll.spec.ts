import { test, expect } from '@playwright/test';
import {
	prepareContext,
	waitForHydration,
	clickDiscussion,
	captureHeaderOnThreadScroll,
	type HeaderScrollCapture
} from './helpers';

/**
 * Mobile Header hide-on-scroll regression coverage for NavPipelineHost routes.
 *
 * The mobile thread page locks the document window (`html.fixed-viewport` makes
 * html/body `position:fixed; overflow:hidden`) and scrolls the thread INSIDE
 * `.detail-scroll-pane` (overflow-y:auto). The shared scroll-chrome store drives
 * the sticky Header's hide-on-down / reveal-on-up animation, so on these routes
 * it must react to the CONTAINER's scroll, not the window's. Pre-fix it only
 * attached its scroll listener to `window`, which never scrolls here, so the
 * Header stayed pinned forever - visibly different from the homepage (where the
 * pipeline tab host's scrolled panel hides the Header correctly).
 *
 * The reported repro is "enter the thread directly at mobile size" (a hard
 * deep-link, no beforeNavigate), so these tests hard-load the URL.
 */

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

/**
 * Pre-fix: both downTranslateY and upTranslateY are 0 (Header never moves).
 * Post-fix: scrolling down hides the Header (translateY << 0); scrolling back to
 * the top reveals it (translateY === 0).
 */
test('REGRESSION: mobile thread Header hides on scroll-down and reveals on scroll-up', async ({
	page
}) => {
	// 1. Obtain a real discussion URL via SPA nav from the list.
	await page.goto('/');
	await waitForHydration(page);
	await clickDiscussion(page, 0);
	await page.waitForURL(/\/discussion\//);
	// Scroll-from-top path: drop the hash so landAtAnchor does not run and the
	// container starts at 0. The bug is independent of the anchor.
	const url = page.url().replace(/#.*$/, '');

	// 2. Hard deep-link at mobile size (the reported entry path).
	await page.goto(url);
	await waitForHydration(page);
	await page.waitForFunction(
		() => {
			const p = document.querySelector('.detail-scroll-pane');
			return !!p && p.scrollHeight > p.clientHeight + 200;
		},
		{ timeout: 8000 }
	);

	const capture: HeaderScrollCapture = await captureHeaderOnThreadScroll(page);

	expect(
		capture.downTranslateY,
		'Header must hide (translateY << 0) when the thread is scrolled down'
	).toBeLessThan(-20);
	expect(
		capture.upTranslateY,
		'Header must reveal (translateY === 0) when scrolled back to the top'
	).toBe(0);
	// The overlay Header must not eat the top of the content: the pane's top
	// padding offsets the first element past the Header (≈ header height).
	expect(
		capture.topFirstContentTop,
		'first content element must sit below the overlay Header (not eaten)'
	).toBeGreaterThanOrEqual(56);
	// When the Header slides away the content card must fill the space it vacated
	// - no header-tall blank gap on top.
	expect(capture.downTopIsCard, 'no blank gap on top when the Header is hidden').toBe(true);
	// Homepage-consistent bottom: the content card ends ABOVE the viewport bottom
	// and the page-bg (base-200) strip shows below it - not the card bg locked to
	// the bottom. Pre-fix the card filled the viewport (no page-bg strip).
	expect(
		capture.bottomCardBottom,
		'content card must end above the viewport bottom (page-bg strip below it)'
	).toBeLessThan(capture.vh);
	expect(capture.bottomIsPageBg, 'bottom edge at scroll-end must be the page-bg strip').toBe(true);
	// Design-system colours: the card is base-100 (white), the pane is base-200
	// (page bg) - the homepage's card-on-page-bg.
	expect(capture.cardBg, 'content card must be base-100 (white)').toMatch(/^rgb\(255, 255, 255\)/);
	expect(capture.paneBg, 'scroll pane must be base-200 (page bg)').not.toContain('255, 255, 255');
});

/**
 * A hash deep-link lands mid-thread via landAtAnchor, which programmatically
 * scrolls the container. That landing scroll must not hide the Header (the hold
 * pins it visible through the landing); at rest the Header must be visible so the
 * user can navigate away. Pre-fix the Header was visible too - but for the wrong
 * reason (the store ignored the container entirely). This test guards a fix that
 * happens to pass the scroll test above while twitching the Header on landing.
 */
test('REGRESSION: hash deep-link lands with the Header visible (no landing twitch)', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	await clickDiscussion(page, 0);
	await page.waitForURL(/\/discussion\//);

	// Pick the LAST reply anchor - near the bottom of the thread, so the landing
	// scroll is a large top→bottom jump (the reported #reply-741274 case). This is
	// the hardest case for the landing hold: without it the down-jump hides the
	// Header and it stays hidden at rest.
	const url = await page.evaluate(() => {
		const anchors = document.querySelectorAll('.detail-scroll-pane [id^="reply-"]');
		const a = anchors[anchors.length - 1];
		return a ? `${location.pathname}#${a.id}` : location.pathname;
	});

	await page.goto(url);
	await waitForHydration(page);
	await page.waitForFunction(() => !!document.querySelector('.detail-scroll-pane'), {
		timeout: 8000
	});
	// Let landAtAnchor settle (≤ ~660ms) plus a buffer.
	await page.waitForTimeout(900);

	const ty = await page.evaluate(() => {
		const h = document.querySelector('header');
		const m = h ? h.style.transform.match(/translateY\(([-0-9.]+)px\)/) : null;
		return m ? Number(m[1]) : 0;
	});
	expect(ty, 'Header must be visible (translateY === 0) after a hash landing').toBe(0);
});
