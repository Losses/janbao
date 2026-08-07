import { test, expect, type Page } from '@playwright/test';
import {
	prepareContext,
	waitForHydration,
	installMultiSignalSampler,
	waitForMultiSignalDone,
	readMultiSignalFrames,
	slowTouchDrag,
	signalRange,
	resetLoaf,
	readLoaf,
	withCpuThrottle,
	type MultiSignalFrame
} from './helpers';

// DV20 regressions: the search-axis swipe, the search-enter animation jank, and
// the first-tab back-swipe boundary. The DV20 plan makes the forward swipe from
// the last tab (Messages) to /search an instance of the same pipeline
// (`{tab, search}` -> `tabSearchResolver`), symmetric with the back-swipe
// /search -> Messages and the root<->search tap morph. These reproduce:
//   3. A leftward (forward) swipe on /messages/inbox must reach /search with a
//      real pipeline animation. The regression cycles the tab highlight through
//      Activity then Discussions and plays no route animation.
//   4. Tapping the search button must animate the root<->search header track
//      smoothly. The regression drops frames severely (the fix must keep the
//      animation, not disable it to hide the jank).
//   5. A rightward (back) swipe on / (Discussions, the leftmost tab) is a
//      boundary: it must rubber-band in place, never highlight Activity or
//      navigate. The regression highlights Activity.

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

async function enterMessagesTab(page: Page): Promise<void> {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
	await page.waitForURL('/messages/inbox');
	await page.waitForSelector('[data-testid="nav-pipeline-tab-track"]');
	await page.waitForTimeout(400);
}

// --- Bug 3 ------------------------------------------------------------------
// Leftward (forward) swipe from /messages/inbox. The DV20 plan's flagship
// requirement: the forward swipe from the last tab reaches /search through the
// tabSearchResolver, with a real pipeline animation (the header root<->search
// track slides) and the header scrub morph. The regression cycles the tab
// highlight through Activity then Discussions and plays no route animation.
test('Bug 3: leftward swipe from /messages/inbox reaches /search with a real animation (no Activity/Discussions cycling)', async ({
	page
}) => {
	await enterMessagesTab(page);
	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.7);
	const endX = startX - 260; // leftward (forward), past SWIPE_COMMIT

	await installMultiSignalSampler(page, 2800);
	await slowTouchDrag(page, { startX, endX, hold: false, steps: 24, stepDelayMs: 22 });
	await waitForMultiSignalDone(page);
	const frames = await readMultiSignalFrames(page);

	// The tab highlight sequence during the swipe. A correct messages -> search
	// transition never passes through Activity or Discussions.
	const seenPills = new Set<string>();
	for (const f of frames) {
		if (f.activePill !== null) seenPills.add(f.activePill);
	}
	const hdrTrack = signalRange(frames, (f) => f.hdrTrackTx);
	const tabTrack = signalRange(frames, (f) => f.tabTrackTx);
	// Vertical-channel morph continuity across the whole gesture (drag +
	// release + commit). The drag branch holds the morph at the source's
	// tab-ness for a `targetIsSearch` forward swipe; the settle that takes
	// over at release latches `startMorph` at that held value and eases
	// toward the SOURCE's at-rest morph (`destMorph = atRestMorph(outgoing)`,
	// matching `startMorph` for a from-rest source with tabs so the morph
	// holds constant and the search-mode flip is carried by the landing),
	// never toward the destination's at-rest morph (which would snap the
	// icon and tab-bar in one rAF frame at release). The multi-signal sampler records rootLayerTy / deepLayerTy
	// / burgerRot every frame; the max frame-to-frame jump of each must
	// stay small.
	const rootJumps = maxFrameJumps(frames, (f) => f.rootLayerTy);
	const deepJumps = maxFrameJumps(frames, (f) => f.deepLayerTy);
	const burgerJumps = maxFrameJumps(frames, (f) => f.burgerRot);
	console.log('Bug3 forward-swipe:', {
		finalPath: frames[frames.length - 1]?.path,
		seenPills: [...seenPills],
		hdrTrackTx: hdrTrack,
		tabTrackTx: tabTrack,
		rootJumps,
		deepJumps,
		burgerJumps
	});

	// The flagship requirement: a committed forward swipe from Messages lands on
	// /search. The regression lands on a boundary (stays on /messages/inbox) or
	// cycles onto /activity or '/'.
	const finalPath = new URL(page.url()).pathname;
	expect(finalPath, 'forward swipe from Messages must reach /search').toBe('/search');

	// A real animation must play. The Header root<->search track slides as the
	// scrub morph runs (driven by `pager.backMorph` + `transitionTarget='/search'`,
	// published independent of the body slide distance). The regression reports
	// "no route animation".
	expect(
		hdrTrack.range,
		'the search transition must animate the header root<->search track, not jump with no animation'
	).toBeGreaterThan(50);

	// The NavPipelineTabHost body track must NOT slide into empty space during
	// the drag. The last tab has no right neighbour in the 3-panel track, so a
	// leftward slide would expose a fourth panel position that does not exist
	// (the /search panel mounts in its own NavPipelineHost on landing). The
	// orchestrator's `#resolvePlan` suppresses the body slide (distance = 0);
	// the track stays at its at-rest position for the whole drag. The regression
	// slides the full viewport width into empty space (range ~= viewport).
	expect(
		tabTrack.range,
		`body tab-host track must NOT slide into empty space during forward-to-/search drag (range was ${tabTrack.range.toFixed(0)}px; expected near 0)`
	).toBeLessThan(30);

	// The highlight must not cycle through the other tabs.
	expect(
		seenPills.has('/activity'),
		'tab highlight must not pass through Activity (regression: cycles Activity then Discussions)'
	).toBe(false);
	expect(
		seenPills.has('/'),
		'tab highlight must not pass through Discussions on a Messages -> search swipe'
	).toBe(false);

	// Vertical-channel morph continuity guard (DV21 §5). The drag's terminal
	// morph must agree with the settle's startMorph at the release handoff so
	// the icon and tab-bar translateY stay continuous across the whole
	// gesture. The threshold allows one rAF of regular progress (~3px / ~13
	// deg at this viewport's header height); a snap lands ~26px / ~119deg.
	expect(
		rootJumps.max,
		`rootLayerTy must not snap at release (max jump ${rootJumps.max.toFixed(2)}px at t=${rootJumps.maxAt}ms)`
	).toBeLessThan(15);
	expect(
		burgerJumps.max,
		`burgerRot must not snap at release (max jump ${burgerJumps.max.toFixed(2)}deg at t=${burgerJumps.maxAt}ms)`
	).toBeLessThan(35);
});

/** Compute the max frame-to-frame absolute jump of a sampled signal across
 *  the multi-signal frame series, plus the timestamp of that max jump. Null
 *  samples (signal absent in that frame) are skipped. Used by the no-snap
 *  guards to assert the morph stays continuous across the drag-to-settle
 *  release boundary (a snap shows up as one frame's delta dwarfing the
 *  regular per-rAF cadence). */
function maxFrameJumps(
	frames: MultiSignalFrame[],
	pick: (f: MultiSignalFrame) => number | null
): { max: number; maxAt: number } {
	let max = 0;
	let maxAt = 0;
	let prev: number | null = null;
	for (const f of frames) {
		const v = pick(f);
		if (v === null) {
			prev = null;
			continue;
		}
		if (prev !== null) {
			const d = Math.abs(v - prev);
			if (d > max) {
				max = d;
				maxAt = f.t;
			}
		}
		prev = v;
	}
	return { max, maxAt };
}

// --- Bug 4 ------------------------------------------------------------------
// Search-APPEAR animation under mobile-class CPU. This dev test asserts the
// animation PLAYS under 4x CPU throttle (the cadence check: the header track
// and/or the page content must slide; it fails if a fix disables the animation
// to hide jank) and logs the worst Long-Animation-Frame for awareness.
//
// The hard jank BUDGET (worst LoAF frame < 150ms at 4x CPU) is enforced against
// the PRODUCTION build by `scripts/measure-search-jank.ts`, NOT here: the dev
// server pays a V8 lazy-JIT cost compiling the `/search` modules on first
// navigation that dominates the frame (~150 to 200ms) and is absent in
// production (pre-bundled). The dev worst-frame number is documentary only.
test('Bug 4: search-appear animation plays under mobile-class CPU (jank budget enforced in production)', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);

	// Inline-style cadence (no getComputedStyle forced recalc) proving the
	// animation PLAYED across the enter, so a fix cannot pass by disabling it.
	await page.evaluate(() => {
		const w = window as unknown as {
			__b4cad?: {
				frames: { t: number; hdr: number | null; deep: number | null }[];
				done: boolean;
				start: number;
			};
		};
		w.__b4cad = { frames: [], done: false, start: performance.now() };
		const parse = (el: Element | null): number | null => {
			const s = el?.getAttribute('style') || '';
			const px = s.match(/translateX\(([-\d.]+)px\)/);
			if (px) return parseFloat(px[1]);
			const pct = s.match(/translateX\(([-\d.]+)%\)/);
			return pct ? parseFloat(pct[1]) : null;
		};
		const tick = (): void => {
			const s = w.__b4cad!;
			const hdr = document.querySelector('header div.flex.w-\\[200\\%\\]');
			const deep = document.querySelector('.detail-scroll-pane')?.parentElement ?? null;
			s.frames.push({ t: performance.now() - s.start, hdr: parse(hdr), deep: parse(deep) });
			if (performance.now() - s.start > 2500) {
				s.done = true;
				return;
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});

	await resetLoaf(page);
	await withCpuThrottle(page, 4, async () => {
		await page.locator('header a[href="/search"][aria-label]').click();
		await page.waitForURL('/search', { timeout: 12000 });
		await page.waitForTimeout(1500);
	});
	await page.waitForFunction(
		() => (window as unknown as { __b4cad?: { done: boolean } }).__b4cad?.done === true,
		{ timeout: 8000 }
	);

	const loaf = await readLoaf(page);
	const cad = (await page.evaluate(
		() =>
			(window as unknown as {
				__b4cad?: { frames: { t: number; hdr: number | null; deep: number | null }[] };
			}).__b4cad!.frames
	))!;
	const maxDur = loaf.reduce((m, e) => Math.max(m, e.duration), 0);
	const top = loaf.slice().sort((a, b) => (b.scriptMs ?? 0) - (a.scriptMs ?? 0))[0];
	const hdrRange = signalRange(cad, (f) => f.hdr).range;
	const deepRange = signalRange(cad, (f) => f.deep).range;
	console.log('Bug4 search-appear @4x CPU:', {
		longFrames: loaf.length,
		maxDur,
		topScript: top ? `${top.scriptMs}ms ${top.scriptFn} (${top.scriptUrl})` : null,
		hdrRange,
		deepRange
	});

	// The animation must actually play under throttle (a fix must not disable it
	// to hide jank). The header track and/or the page content must slide.
	expect(
		Math.max(hdrRange, deepRange),
		'search enter must animate the header track and/or the page content'
	).toBeGreaterThan(10);
	// The hard jank BUDGET (worst LoAF frame < 150ms at 4x CPU) lives in
	// `scripts/measure-search-jank.ts`, which measures the PRODUCTION build. The
	// dev server pays a V8 lazy-JIT cost compiling the `/search` modules on first
	// navigation (~150 to 200ms frame floor) that swamps the real jank cost and
	// is absent in production (pre-bundled), so the dev worst-frame number logged
	// above is documentary only, not a gate. Run the script for the authoritative
	// check (production measures ~60 to 85ms).
});

// --- Bug 5 ------------------------------------------------------------------
// Rightward swipe on the Discussions home (the leftmost tab). There is no
// neighbouring tab in the swipe direction, so this is a boundary and the
// Activity pill must never light up: neither its label expansion (closeness ->
// labelStyle max-width) nor its active state.
//
// "Highlight" is the per-frame label EXPANSION (driven by the pager's
// fractionalIndex), NOT the committed aria-current pill, so a brief expansion
// during the gesture is caught even when aria-current stays on Discussions.
//
// The gesture is swept across drag distances (the bug may be distance-gated)
// with full instrumentation: each pill's label max-width, the pager
// fractionalIndex, and the tab-track translateX (to confirm the gesture
// actually engaged the pager). Committed (released) swipes, like a real user
// gesture.
interface B5Pill {
	href: string | null;
	maxRem: number;
	active: boolean;
}
interface B5Frame {
	t: number;
	frac: number | null;
	trackTx: number | null;
	pills: B5Pill[];
}
interface B5Window extends Window {
	__b5?: { frames: B5Frame[]; done: boolean; start: number };
}

async function installB5Sampler(page: Page, windowMs: number): Promise<void> {
	await page.evaluate((windowMs) => {
		const w = window as unknown as B5Window;
		w.__b5 = { frames: [], done: false, start: performance.now() };
		const readPills = (): B5Pill[] =>
			Array.from(document.querySelectorAll('header nav a[data-tab-nav]')).map((a) => {
				const span = a.querySelector('span.overflow-hidden');
				const style = span?.getAttribute('style') || '';
				const m = style.match(/max-width:\s*([\d.]+)rem/);
				return {
					href: a.getAttribute('href'),
					maxRem: m ? parseFloat(m[1]) : 0,
					active: a.getAttribute('aria-current') === 'page'
				};
			});
		const txOf = (el: Element | null): number | null => {
			if (!el) return null;
			try {
				return new DOMMatrix(getComputedStyle(el).transform).m41;
			} catch {
				return null;
			}
		};
		const tick = (): void => {
			const pp = (
				window as unknown as {
					__primaryPager?: { fractionalIndex: number; backMorph: number | null };
				}
			).__primaryPager;
			w.__b5!.frames.push({
				t: performance.now() - w.__b5!.start,
				frac: pp ? pp.fractionalIndex : null,
				trackTx: txOf(document.querySelector('[data-testid="nav-pipeline-tab-track"]')),
				pills: readPills()
			});
			if (performance.now() - w.__b5!.start > windowMs) {
				w.__b5!.done = true;
				return;
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}, windowMs);
}

test('Bug 5: rightward swipe on / (Discussions) never lights up Activity, across drag distances', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForSelector('[data-testid="nav-pipeline-tab-track"]');
	await page.waitForTimeout(400);

	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.3);
	const distances = [80, 160, 240, 320];
	const summary: Array<{ dist: number; actMaxRem: number; actActive: boolean; fracMin: number | null; fracMax: number | null; trackRange: number; finalPath: string }> = [];

	for (const dist of distances) {
		await installB5Sampler(page, 1800);
		await slowTouchDrag(page, {
			startX,
			endX: startX + dist,
			hold: false,
			steps: 18,
			stepDelayMs: 22
		});
		await page.waitForFunction(
			() => (window as unknown as B5Window).__b5?.done === true,
			{ timeout: 6000 }
		);
		const frames = (await page.evaluate(() => (window as unknown as B5Window).__b5!.frames))!;
		const actMax = Math.max(
			...frames.map((f) => f.pills.find((p) => p.href === '/activity')?.maxRem ?? 0)
		);
		const actActive = frames.some(
			(f) => f.pills.find((p) => p.href === '/activity')?.active === true
		);
		const fracs = frames.map((f) => f.frac).filter((v): v is number => v !== null);
		const tracks = frames.map((f) => f.trackTx).filter((v): v is number => v !== null);
		const entry = {
			dist,
			actMaxRem: actMax,
			actActive,
			fracMin: fracs.length ? Math.min(...fracs) : null,
			fracMax: fracs.length ? Math.max(...fracs) : null,
			trackRange: tracks.length ? Math.max(...tracks) - Math.min(...tracks) : 0,
			finalPath: new URL(page.url()).pathname
		};
		summary.push(entry);
		// Return to '/' in case a swipe navigated (a boundary must not, but be safe).
		if (entry.finalPath !== '/') {
			await page.goto('/');
			await waitForHydration(page);
			await page.waitForSelector('[data-testid="nav-pipeline-tab-track"]');
		}
		await page.waitForTimeout(150);
	}

	console.log('Bug5 discussions-home rightward sweep:', summary);

	for (const e of summary) {
		expect(
			e.actActive,
			`dist ${e.dist}px: Activity must never become the active pill`
		).toBe(false);
		expect(
			e.actMaxRem,
			`dist ${e.dist}px: Activity pill must not expand (max label width ${e.actMaxRem.toFixed(2)}rem; fractionalIndex range ${e.fracMin}..${e.fracMax}, track range ${e.trackRange.toFixed(0)}px)`
		).toBeLessThan(0.5);
	}
});
