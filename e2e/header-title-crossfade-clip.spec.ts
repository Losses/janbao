import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

/**
 * Header deep→deep title crossfade CLIP-BOX reproduction spec.
 *
 * Symptom (reported): on mobile, on a deep page (e.g. /profile/settings "账号
 * 设置"), tapping a link to another deep page (e.g. /profile/edit "编辑资料")
 * plays a vertical title crossfade — the incoming title rises and the outgoing
 * title exits upward — but the animation is clipped to a box that is SMALLER
 * than the App Bar (Action Bar). Text is cut at an invisible horizontal line
 * ~8px INSIDE the bar's top and bottom edges, so the two titles appear to push
 * each other inside a "window" that does not fill the bar.
 *
 * Root cause (structural): the title crossfade lives INSIDE the deep title layer
 *   <div class="absolute inset-0 ... overflow-hidden" style={layerDownStyle}>
 * which is `absolute inset-0` of the title slot
 *   <div class="relative h-10 flex-1">
 * which itself sits inside panel 0
 *   <div class="flex w-1/2 shrink-0 items-center px-2 py-2">
 * So the clip box is the inner h-10 (40px) title slot, while the App Bar is
 * h-10 + py-2 + py-2 = 56px. The clip box is therefore inset 8px (= py-2) from
 * the bar's top AND bottom. The crossfade slides titles by ±100% of THAT 40px
 * box, so text is cut at y∈[8,48] while the bar occupies y∈[0,56].
 *
 * Why the three tabs do NOT show this (the reported asymmetry): the tabs live in
 * a SIBLING layer
 *   <div class="absolute inset-0 flex items-center justify-center" style={rootLayerStyle}>
 * which has NO `overflow-hidden` (computed overflow: visible). Its content
 * overflows the 40px slot and is clipped by the OUTER
 *   <div class="relative overflow-clip md:hidden">
 * which spans the full 56px bar. So the tab morph uses the bar's real bounding
 * box; only the title-text crossfade is confined to the inset h-10 slot. Two
 * different clip containers for two animations in the same bar — that is the
 * defect.
 *
 * Scope: affects EVERY deep→deep title crossfade (any nav between two titled
 * deep pages — /profile/*, /admin/*, /bookmarks↔/drafts, … ~24 deep routes in
 * deep-header-config.ts). It is NOT a single-route typo. It is isolated to the
 * title-crossfade animation: the root↔deep morph, the search morph and the tab
 * pill morph all clip against the full bar and are unaffected.
 *
 * This spec instruments the geometry directly. A per-frame rAF probe records the
 * App Bar rect, the title clip-box rect, and each title span's rect during the
 * crossfade. The DEFECT signature is clipBox ⊊ headerBox (clip inset from the
 * bar). Correct behaviour is clipBox == headerBox (the crossfade fills the bar).
 *
 * Assertions encode the CORRECT behaviour, so they FAIL on the current code; the
 * failure message dumps the captured geometry as evidence. A CALIBRATION test
 * characterises the current broken geometry (clip 40px inset 8/8 inside a 56px
 * bar; tabs layer overflow:visible, title layer overflow:hidden) and PASSES, so
 * the spec is self-anchoring.
 */

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

interface ClipSpan {
	text: string;
	top: number;
	bottom: number;
}

interface ClipFrame {
	hdrTop: number;
	hdrBottom: number;
	clipTop: number | null;
	clipBottom: number | null;
	spanCount: number;
	spans: ClipSpan[];
	tabsOverflow: string | null;
	clipOverflow: string | null;
}

interface ClipCapture {
	/** Static App Bar geometry (first frame the clip box was found). */
	hdrTop: number;
	hdrBottom: number;
	hdrHeight: number;
	/** Static title clip-box geometry. */
	clipTop: number;
	clipBottom: number;
	clipHeight: number;
	/** How far the clip box is inset from the bar edges (the defect magnitude). */
	topInset: number;
	bottomInset: number;
	/** Frames during which two titles were simultaneously rendered (the crossfade). */
	crossfadeFrameCount: number;
	totalFrameCount: number;
	/** Furthest a title span reached above/below the bar during the crossfade. */
	titleMinTop: number | null;
	titleMaxBottom: number | null;
	/** computed overflow of the tabs layer (rootLayerStyle) — 'visible' = full bar. */
	tabsOverflow: string | null;
	/** computed overflow of the title layer (layerDownStyle) — 'hidden' = inset slot. */
	clipOverflow: string | null;
	/** True iff some crossfade frame had a title span whose rect lay in the inset
	 * band (between the clip edge and the bar edge) — i.e. text was cut at the
	 * inset boundary, not the bar edge. */
	spanCutAtInset: boolean;
}

/**
 * Install a continuous rAF probe over the App Bar + title clip-box geometry. The
 * probe re-queries the title slot every frame (so a DOM swap mid-crossfade
 * cannot strand it) and pushes each sample to the Node side via exposeBinding so
 * the buffer survives. SPA nav (the only kind these tests trigger) is
 * same-document, but the robust addInitScript pattern is kept for parity with
 * fab-deep-page-boundary.spec.ts.
 */
async function captureTitleClip(
	page: import('@playwright/test').Page,
	trigger: () => Promise<void>,
	windowMs = 900
): Promise<ClipCapture> {
	const samples: ClipFrame[] = [];
	try {
		await page.exposeBinding('__pushClip', async (_src, value: ClipFrame) => {
			samples.push(value);
		});
	} catch {
		/* already exposed on a reused page in the same worker */
	}
	const arm = async (v: boolean): Promise<void> =>
		page.evaluate((b) => {
			(window as unknown as { __clipArmed?: boolean }).__clipArmed = b;
		}, v);
	const probe = (): void => {
		const g = window as unknown as {
			__clipArmed?: boolean;
			__pushClip?: (v: ClipFrame) => void;
		};
		const tick = (): void => {
			if (g.__clipArmed === true) {
				const header = document.querySelector('header');
				const slot = header && header.querySelector('.relative.h-10.flex-1');
				const h = header ? header.getBoundingClientRect() : null;
				let clipTop: number | null = null;
				let clipBottom: number | null = null;
				let clipOverflow: string | null = null;
				let tabsOverflow: string | null = null;
				const spans: ClipSpan[] = [];
				if (slot) {
					const kids = Array.from(slot.children);
					const clip = kids.find((c) => c.classList.contains('overflow-hidden'));
					const tabs = kids.find((c) => !c.classList.contains('overflow-hidden'));
					if (clip) {
						const r = clip.getBoundingClientRect();
						clipTop = r.top;
						clipBottom = r.bottom;
						clipOverflow = getComputedStyle(clip).overflow;
						Array.from(clip.querySelectorAll('span')).forEach((s) => {
							const r2 = s.getBoundingClientRect();
							spans.push({ text: (s.textContent || '').trim(), top: r2.top, bottom: r2.bottom });
						});
					}
					if (tabs) tabsOverflow = getComputedStyle(tabs).overflow;
				}
				g.__pushClip?.({
					hdrTop: h ? h.top : 0,
					hdrBottom: h ? h.bottom : 0,
					clipTop,
					clipBottom,
					spanCount: spans.length,
					spans,
					tabsOverflow,
					clipOverflow
				});
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	};
	await page.addInitScript(probe);
	await page.evaluate(probe);
	await arm(true);
	await trigger();
	await page.waitForTimeout(windowMs);
	await arm(false);

	const firstWithClip = samples.find((s) => s.clipTop !== null && s.clipBottom !== null);
	const hdrTop = firstWithClip ? firstWithClip.hdrTop : 0;
	const hdrBottom = firstWithClip ? firstWithClip.hdrBottom : 0;
	const clipTop = firstWithClip ? (firstWithClip.clipTop as number) : 0;
	const clipBottom = firstWithClip ? (firstWithClip.clipBottom as number) : 0;
	const crossfade = samples.filter((s) => s.spanCount >= 2);
	let titleMinTop: number | null = null;
	let titleMaxBottom: number | null = null;
	let spanCutAtInset = false;
	for (const f of crossfade) {
		for (const sp of f.spans) {
			titleMinTop = titleMinTop === null ? sp.top : Math.min(titleMinTop, sp.top);
			titleMaxBottom = titleMaxBottom === null ? sp.bottom : Math.max(titleMaxBottom, sp.bottom);
			// A span rect between the clip edge and the bar edge = text the bar
			// COULD show but the inset clip cuts off.
			if (sp.bottom > (f.clipBottom ?? clipBottom) && sp.bottom <= f.hdrBottom) spanCutAtInset = true;
			if (sp.top < (f.clipTop ?? clipTop) && sp.top >= f.hdrTop) spanCutAtInset = true;
		}
	}
	return {
		hdrTop: Math.round(hdrTop),
		hdrBottom: Math.round(hdrBottom),
		hdrHeight: Math.round(hdrBottom - hdrTop),
		clipTop: Math.round(clipTop),
		clipBottom: Math.round(clipBottom),
		clipHeight: Math.round(clipBottom - clipTop),
		topInset: Math.round(clipTop - hdrTop),
		bottomInset: Math.round(hdrBottom - clipBottom),
		crossfadeFrameCount: crossfade.length,
		totalFrameCount: samples.length,
		titleMinTop: titleMinTop === null ? null : Math.round(titleMinTop),
		titleMaxBottom: titleMaxBottom === null ? null : Math.round(titleMaxBottom),
		tabsOverflow: firstWithClip ? firstWithClip.tabsOverflow : null,
		clipOverflow: firstWithClip ? firstWithClip.clipOverflow : null,
		spanCutAtInset
	};
}

/** Render a capture as a compact geometry string for failure messages. */
function dump(c: ClipCapture): string {
	return (
		`bar[h=${c.hdrHeight} top=${c.hdrTop} bottom=${c.hdrBottom}] ` +
		`clip[h=${c.clipHeight} top=${c.clipTop} bottom=${c.clipBottom}] ` +
		`inset(top=${c.topInset} bottom=${c.bottomInset}) ` +
		`crossfadeFrames=${c.crossfadeFrameCount}/${c.totalFrameCount} ` +
		`titleExcursion(top=${c.titleMinTop} bottom=${c.titleMaxBottom}) ` +
		`spanCutAtInset=${String(c.spanCutAtInset)} ` +
		`tabsOverflow=${c.tabsOverflow} clipOverflow=${c.clipOverflow}`
	);
}

// CALIBRATION (PASSES on current code, anchors the defect + the asymmetry):
// - the App Bar is 56px; the title clip box is the inner 40px h-10 slot, inset
//   8px (= py-2) top and bottom.
// - the tabs layer overflows visibly (clipped by the full-bar outer box); the
//   title layer is overflow:hidden (clipped to the inset slot). That pair is the
//   structural reason the tab morph fills the bar but the title crossfade does not.
test('CALIBRATION: title clip box is the inset h-10 slot, not the 56px App Bar', async ({ page }) => {
	await page.goto('/profile/settings');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	const g = await page.evaluate(() => {
		const header = document.querySelector('header');
		const slot = header && header.querySelector('.relative.h-10.flex-1');
		const kids = slot ? Array.from(slot.children) : [];
		const clip = kids.find((c) => c.classList.contains('overflow-hidden'));
		const tabs = kids.find((c) => !c.classList.contains('overflow-hidden'));
		const hr = header ? header.getBoundingClientRect() : null;
		const cr = clip ? clip.getBoundingClientRect() : null;
		return {
			hdrHeight: hr ? hr.height : 0,
			clipHeight: cr ? cr.height : 0,
			topInset: cr && hr ? cr.top - hr.top : 0,
			bottomInset: cr && hr ? hr.bottom - cr.bottom : 0,
			tabsOverflow: tabs ? getComputedStyle(tabs).overflow : null,
			clipOverflow: clip ? getComputedStyle(clip).overflow : null
		};
	});

	expect(g.hdrHeight, 'App Bar height').toBeCloseTo(56, 0);
	expect(g.clipHeight, 'title clip box height (h-10 slot)').toBeCloseTo(40, 0);
	expect(g.topInset, 'clip inset from bar top = py-2 (8px)').toBeCloseTo(8, 0);
	expect(g.bottomInset, 'clip inset from bar bottom = py-2 (8px)').toBeCloseTo(8, 0);
	// The defect witness: the clip is strictly smaller than the bar.
	expect(g.clipHeight, 'clip box must be smaller than the bar (the defect)').toBeLessThan(g.hdrHeight);
	// The asymmetry witness: tabs use the full bar, titles do not.
	expect(g.tabsOverflow, 'tabs layer overflow (full-bar clip)').toBe('visible');
	expect(g.clipOverflow, 'title layer overflow (inset-slot clip)').toBe('hidden');
});

// Forward nav /profile/settings -> /profile/edit ("账号设置" -> "编辑资料"), the
// reported case. A correct crossfade clips against the App Bar bounding box, so
// the title slot's clip box must coincide with the bar (top/bottom insets ≈ 0).
// The current code clips to the inset h-10 slot, so topInset/bottomInset ≈ 8.
test('DEFECT: /profile/settings -> /profile/edit title crossfade clips to the inset slot, not the App Bar', async ({
	page
}) => {
	await page.goto('/profile/settings');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	const capture = await captureTitleClip(page, async () => {
		await page.locator('main a[href="/profile/edit"]').first().click();
		await page.waitForURL('**/profile/edit', { timeout: 5000 });
	});

	// Anchor: the crossfade actually played (two titles simultaneously on stage).
	expect(
		capture.crossfadeFrameCount,
		`the probe must capture the crossfade. ${dump(capture)}`
	).toBeGreaterThan(0);

	// Correct behaviour: the title clip box fills the App Bar (no inset). FAILS
	// on current code because the clip is the h-10 slot inset by py-2.
	expect(
		capture.topInset,
		`title clip must start at the App Bar top edge, not 8px inside it. ${dump(capture)}`
	).toBeCloseTo(0, 0);
	expect(
		capture.bottomInset,
		`title clip must end at the App Bar bottom edge, not 8px inside it. ${dump(capture)}`
	).toBeCloseTo(0, 0);
});

// Back nav /profile/edit -> /profile/settings ("编辑资料" -> "账号设置"). The
// title state machine runs the same crossfade for a non-gesture back navigation
// (Effect C idle branch), so the same inset clip applies in the reverse direction.
// History is seeded by first navigating FORWARD /profile/settings -> /profile/edit
// so page.goBack() has a real entry to pop back to /profile/settings.
test('DEFECT: /profile/edit -> /profile/settings back-nav crossfade clips to the inset slot, not the App Bar', async ({
	page
}) => {
	await page.goto('/profile/settings');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	await page.locator('main a[href="/profile/edit"]').first().click();
	await page.waitForURL('**/profile/edit', { timeout: 5000 });
	await page.waitForTimeout(300);

	const capture = await captureTitleClip(page, async () => {
		await page.goBack();
		await page.waitForURL('**/profile/settings', { timeout: 5000 });
	});

	expect(
		capture.crossfadeFrameCount,
		`the probe must capture the crossfade. ${dump(capture)}`
	).toBeGreaterThan(0);
	expect(
		capture.topInset,
		`title clip must start at the App Bar top edge. ${dump(capture)}`
	).toBeCloseTo(0, 0);
	expect(
		capture.bottomInset,
		`title clip must end at the App Bar bottom edge. ${dump(capture)}`
	).toBeCloseTo(0, 0);
});
