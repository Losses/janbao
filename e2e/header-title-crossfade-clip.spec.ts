import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

/**
 * Header deep→deep title crossfade clip-box regression spec.
 *
 * The App Bar's deep→deep title crossfade (e.g. /profile/settings 账号设置 →
 * /profile/edit 编辑资料) slides the outgoing title up and the incoming title up
 * from below. The animation is clipped to the App Bar bounding box so the two
 * titles cross inside the full bar.
 *
 * The clip lives on panel 0, the bar-height container in Header.svelte, and the
 * title layer (layerDownStyle) relies on that ancestor for its clipping. This
 * keeps the clip box coincident with the <header> (y∈[0,56]) rather than the
 * inner h-10 (40px) title slot. The h-10 slot sits 8px inset top and bottom
 * inside the py-2 padding, so clipping there cuts the crossing text 8px short of
 * either bar edge. The tab morph (rootLayerStyle) shares the same panel-0 clip,
 * so both animations clip at the bar edges consistently.
 *
 * The spec guards the invariant two ways:
 *  - STATIC: the title layer's nearest clipping ancestor coincides with the
 *    <header> box, and the tabs layer shares that same ancestor.
 *  - DYNAMIC: during a live crossfade, the visible title text reaches both bar
 *    edges (top ≈ 0, bottom ≈ 56), proving the animation fills the bar.
 */

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

interface ClipGeometry {
	hdrTop: number;
	hdrBottom: number;
	hdrHeight: number;
	titleClipTop: number;
	titleClipBottom: number;
	titleTopInset: number;
	titleBottomInset: number;
	tabsClipTop: number;
	tabsClipBottom: number;
	tabsTopInset: number;
	tabsBottomInset: number;
	/** Whether both layers share one clipping ancestor (the panel-0 container). */
	sameClipAncestor: boolean;
}

/**
 * Walk up from each title-slot child to its nearest clipping ancestor
 * (computed overflow hidden/clip) and compare that ancestor's box to the
 * <header> box. This measures the box that ACTUALLY clips the layer, regardless
 * of which element carries the overflow-hidden class, so the assertion holds as
 * long as the effective clip matches the bar.
 */
async function measureClipGeometry(page: import('@playwright/test').Page): Promise<ClipGeometry> {
	return page.evaluate(() => {
		const header = document.querySelector('header');
		const slot = header && header.querySelector('.relative.h-10.flex-1');
		const kids = slot ? Array.from(slot.children) : [];
		// layerDownStyle carries px-2; rootLayerStyle does not.
		const titleLayer = kids.find((c) => c.classList.contains('px-2')) as HTMLElement | undefined;
		const tabsLayer = kids.find((c) => !c.classList.contains('px-2')) as HTMLElement | undefined;
		const clipAncestor = (el: HTMLElement | undefined): HTMLElement | null => {
			if (!el) return null;
			let cur: HTMLElement | null = el;
			while (cur && cur !== document.body) {
				const ov = getComputedStyle(cur).overflow;
				if (ov === 'hidden' || ov === 'clip') return cur;
				cur = cur.parentElement;
			}
			return null;
		};
		const hr = header ? header.getBoundingClientRect() : new DOMRect();
		const tca = clipAncestor(titleLayer);
		const taxa = clipAncestor(tabsLayer);
		const tcr = tca ? tca.getBoundingClientRect() : new DOMRect();
		const tacr = taxa ? taxa.getBoundingClientRect() : new DOMRect();
		return {
			hdrTop: Math.round(hr.top),
			hdrBottom: Math.round(hr.bottom),
			hdrHeight: Math.round(hr.height),
			titleClipTop: Math.round(tcr.top),
			titleClipBottom: Math.round(tcr.bottom),
			titleTopInset: Math.round(tcr.top - hr.top),
			titleBottomInset: Math.round(hr.bottom - tcr.bottom),
			tabsClipTop: Math.round(tacr.top),
			tabsClipBottom: Math.round(tacr.bottom),
			tabsTopInset: Math.round(tacr.top - hr.top),
			tabsBottomInset: Math.round(hr.bottom - tacr.bottom),
			sameClipAncestor: tca !== null && taxa !== null && tca === taxa
		};
	});
}

interface VisCapture {
	crossfadeFrameCount: number;
	totalFrameCount: number;
	/** Smallest visible-top of any title span during the crossfade (bar top = 0). */
	minVisibleTop: number | null;
	/** Largest visible-bottom of any title span during the crossfade (bar bottom = 56). */
	maxVisibleBottom: number | null;
}

/**
 * Sample the crossfade frame-by-frame. Each frame finds the title layer's
 * clipping ancestor, intersects every title span's rect with that clip rect, and
 * records the visible extent. A crossfade that fills the bar reaches visible-top
 * near 0 and visible-bottom near 56.
 */
async function captureCrossfadeVisibility(
	page: import('@playwright/test').Page,
	trigger: () => Promise<void>,
	windowMs = 900
): Promise<VisCapture> {
	const samples: { spanCount: number; minVisTop: number; maxVisBot: number }[] = [];
	try {
		await page.exposeBinding('__pushVis', async (_src, value: { spanCount: number; minVisTop: number; maxVisBot: number }) => {
			samples.push(value);
		});
	} catch {
		/* already exposed on a reused page in the same worker */
	}
	const arm = async (v: boolean): Promise<void> =>
		page.evaluate((b) => {
			(window as unknown as { __visArmed?: boolean }).__visArmed = b;
		}, v);
	const probe = (): void => {
		const g = window as unknown as {
			__visArmed?: boolean;
			__pushVis?: (v: { spanCount: number; minVisTop: number; maxVisBot: number }) => void;
		};
		const clipAncestorRect = (el: HTMLElement): DOMRect | null => {
			let cur: HTMLElement | null = el;
			while (cur && cur !== document.body) {
				const ov = getComputedStyle(cur).overflow;
				if (ov === 'hidden' || ov === 'clip') return cur.getBoundingClientRect();
				cur = cur.parentElement;
			}
			return null;
		};
		const tick = (): void => {
			if (g.__visArmed === true) {
				const header = document.querySelector('header');
				const slot = header && header.querySelector('.relative.h-10.flex-1');
				const kids = slot ? Array.from(slot.children) : [];
				const titleLayer = kids.find((c) => c.classList.contains('px-2')) as HTMLElement | undefined;
				let spanCount = 0;
				let minVisTop = Infinity;
				let maxVisBot = -Infinity;
				if (titleLayer) {
					const clip = clipAncestorRect(titleLayer);
					Array.from(titleLayer.querySelectorAll('span')).forEach((s) => {
						const r = s.getBoundingClientRect();
						spanCount += 1;
						const visTop = clip ? Math.max(r.top, clip.top) : r.top;
						const visBot = clip ? Math.min(r.bottom, clip.bottom) : r.bottom;
						if (visBot - visTop > 0.5) {
							minVisTop = Math.min(minVisTop, visTop);
							maxVisBot = Math.max(maxVisBot, visBot);
						}
					});
				}
				g.__pushVis?.({
					spanCount,
					minVisTop: minVisTop === Infinity ? Number.NaN : minVisTop,
					maxVisBot: maxVisBot === -Infinity ? Number.NaN : maxVisBot
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

	const crossfade = samples.filter((s) => s.spanCount >= 2);
	let minTop = Infinity;
	let maxBot = -Infinity;
	for (const s of crossfade) {
		if (!Number.isNaN(s.minVisTop)) minTop = Math.min(minTop, s.minVisTop);
		if (!Number.isNaN(s.maxVisBot)) maxBot = Math.max(maxBot, s.maxVisBot);
	}
	return {
		crossfadeFrameCount: crossfade.length,
		totalFrameCount: samples.length,
		minVisibleTop: minTop === Infinity ? null : Math.round(minTop),
		maxVisibleBottom: maxBot === -Infinity ? null : Math.round(maxBot)
	};
}

function dump(c: VisCapture): string {
	return `crossfadeFrames=${c.crossfadeFrameCount}/${c.totalFrameCount} minVisibleTop=${c.minVisibleTop} maxVisibleBottom=${c.maxVisibleBottom}`;
}

// The title crossfade's clipping ancestor is the App Bar bounding box. The clip
// lives on panel 0 (the bar-height container), so the title layer's nearest
// overflow ancestor coincides with the <header>, not the inset h-10 title slot.
test('title crossfade is clipped by the App Bar bounding box, not the inset h-10 slot', async ({
	page
}) => {
	await page.goto('/profile/settings');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	const g = await measureClipGeometry(page);

	expect(g.hdrHeight, 'App Bar height').toBeCloseTo(56, 0);
	expect(
		g.titleTopInset,
		`title clip must start at the App Bar top edge, not 8px inside it.`
	).toBeCloseTo(0, 0);
	expect(
		g.titleBottomInset,
		`title clip must end at the App Bar bottom edge, not 8px inside it.`
	).toBeCloseTo(0, 0);
	// The title crossfade and the tab morph share one clipping ancestor (panel 0),
	// so both clip at the bar edges rather than each at a different sub-box.
	expect(
		g.tabsTopInset,
		`tabs clip must start at the App Bar top edge (same box as the title).`
	).toBeCloseTo(0, 0);
	expect(
		g.tabsBottomInset,
		`tabs clip must end at the App Bar bottom edge (same box as the title).`
	).toBeCloseTo(0, 0);
	expect(
		g.sameClipAncestor,
		`the title and tabs layers must share one clipping ancestor (panel 0), so the morph and the crossfade clip consistently.`
	).toBe(true);
});

// During the crossfade the visible title text must reach BOTH bar edges - top
// near 0 and bottom near 56 - i.e. the animation fills the full bar height.
test('forward crossfade fills the App Bar: visible title reaches top≈0 and bottom≈56', async ({
	page
}) => {
	await page.goto('/profile/settings');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	const cap = await captureCrossfadeVisibility(page, async () => {
		await page.locator('main a[href="/profile/edit"]').first().click();
		await page.waitForURL('**/profile/edit', { timeout: 5000 });
	});

	expect(cap.crossfadeFrameCount, `the crossfade must play. ${dump(cap)}`).toBeGreaterThan(0);
	expect(
		cap.minVisibleTop,
		`incoming/outgoing title must reach the bar top edge, not stop 8px short. ${dump(cap)}`
	).toBeLessThanOrEqual(4);
	expect(
		cap.maxVisibleBottom,
		`incoming/outgoing title must reach the bar bottom edge, not stop 8px short. ${dump(cap)}`
	).toBeGreaterThanOrEqual(52);
});

// History is seeded by a forward nav first so page.goBack() has a real entry to
// pop. The title state machine runs the same crossfade for a non-gesture back
// navigation.
test('back-nav crossfade fills the App Bar: visible title reaches top≈0 and bottom≈56', async ({
	page
}) => {
	await page.goto('/profile/settings');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	await page.locator('main a[href="/profile/edit"]').first().click();
	await page.waitForURL('**/profile/edit', { timeout: 5000 });
	await page.waitForTimeout(300);

	const cap = await captureCrossfadeVisibility(page, async () => {
		await page.goBack();
		await page.waitForURL('**/profile/settings', { timeout: 5000 });
	});

	expect(cap.crossfadeFrameCount, `the crossfade must play. ${dump(cap)}`).toBeGreaterThan(0);
	expect(
		cap.minVisibleTop,
		`title must reach the bar top edge on back-nav too, not stop 8px short. ${dump(cap)}`
	).toBeLessThanOrEqual(4);
	expect(
		cap.maxVisibleBottom,
		`title must reach the bar bottom edge on back-nav too, not stop 8px short. ${dump(cap)}`
	).toBeGreaterThanOrEqual(52);
});
