import { test, expect, type Page } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

/**
 * Header tab-descent regression spec.
 *
 * The mobile Header's tabs layer sits at translateY(-100%) on a deep page and
 * descends to translateY(0%) when the route returns to a tab route (the "Tab
 * descent" animation). The descent is rAF-driven. Two arm timings cover the
 * cycle exercised here:
 *
 *   - Forward (tab to deep, e.g. /messages/inbox to /bookmarks): the
 *     orchestrator does NOT intercept this nav (the destination is not a tab
 *     root and not a deep-to-deep), so the settle is armed at the navigation
 *     landing by `notifyHeaderState`'s idle title-change arm. The rAF owns the
 *     descent from the landing flush onward.
 *   - Back (deep to tab, e.g. /bookmarks to /messages/inbox): the orchestrator
 *     intercepts the nav in `onSvelteKitBeforeNavigate`'s discrete-nav branch
 *     and arms the settle rAF CONCURRENTLY with the slide, velocity-matched to
 *     the slide via `commitStart.durationMs`. The rAF publishes
 *     `settleProgress` 0 to 1 with the constant-deceleration ease `2u - u²`
 *     while the route is still on the source path; the morph derivation reads
 *     `settleProgress` and the layer transform follows `morph` 1:1.
 *
 * In both directions the descent animates through real intermediate values
 * every frame. No CSS transition is involved.
 *
 * Tests:
 *   - CALIBRATION: documents both arm timings in one cycle - the forward
 *     landing flush has settling === true (the idle arm), and the back slide
 *     has settling === true with intermediate morph on the source route
 *     (sampled via the internal per-flush probe window.__headerMorphProbe).
 *   - DEFECT: across multiple messages to bookmarks cycles every back slide
 *     must arm the settle and animate the morph (the rAF owns the descent,
 *     never a static snap).
 */

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

interface SettleFrame {
	t: number;
	path: string;
	rootTargetTy: number | null; // % from inline style.transform
	rootComputedPx: number | null; // m42 (px) from getComputedStyle
	rootTransition: string;
}

interface SamplerWindow extends Window {
	__settleLog?: SettleFrame[];
	__settleStop?: boolean;
}

interface HeaderSnap {
	t: number;
	path: string;
	morph: number;
	settling: boolean;
	currentHasTabs: boolean;
}

interface HeaderLogWindow extends Window {
	__headerMorphProbe?: HeaderSnap[];
}

const CAP = 8000;

async function installSampler(page: Page): Promise<void> {
	await page.evaluate((cap) => {
		const w = window as unknown as SamplerWindow;
		const log: SettleFrame[] = [];
		w.__settleLog = log;
		w.__settleStop = false;
		const parseTy = (s: string): number | null => {
			const m = s.match(/translateY\((-?\d+(?:\.\d+)?)%\)/);
			return m ? parseFloat(m[1]) : null;
		};
		const tick = (): void => {
			const nodes = Array.from(
				document.querySelectorAll('header div.relative.h-10.flex-1 > div')
			) as HTMLElement[];
			const root = nodes[0];
			let rootComputedPx: number | null = null;
			if (root) {
				try {
					rootComputedPx = new DOMMatrix(getComputedStyle(root).transform).m42;
				} catch {
					rootComputedPx = null;
				}
			}
			log.push({
				t: Math.round(performance.now()),
				path: location.pathname,
				rootTargetTy: root ? parseTy(root.style.transform) : null,
				rootComputedPx,
				rootTransition: root ? root.style.transition : ''
			});
			if (log.length > cap) log.splice(0, log.length - cap);
			if (!w.__settleStop) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}, CAP);
}

async function stopAndRead(page: Page): Promise<SettleFrame[]> {
	return page.evaluate(() => {
		const w = window as unknown as SamplerWindow;
		w.__settleStop = true;
		return w.__settleLog ?? [];
	});
}

async function readHeaderLog(page: Page): Promise<HeaderSnap[]> {
	return page.evaluate(() => {
		const w = window as unknown as HeaderLogWindow;
		return w.__headerMorphProbe ?? [];
	});
}

function pathChangeIndices(frames: SettleFrame[]): number[] {
	const out: number[] = [];
	for (let i = 1; i < frames.length; i++) {
		if (frames[i].path !== frames[i - 1].path) out.push(i);
	}
	return out;
}

interface LandingFlush {
	t: number;
	morph: number;
	settling: boolean; // the rAF settle owns the descent at this flush
}

/** Find every flush where currentHasTabs flipped (the layer committed to its new
 *  rest mode). dir='in' = deep→tab (back landing, tabs descend); dir='out' =
 *  tab→deep (forward landing, tabs ascend). Paint-independent: reads the per-flush
 *  Header probe, so it catches the commit flush even when the navigation blocks
 *  the main thread between paints (where a rAF sampler drops frames). */
function landings(snaps: HeaderSnap[], dir: 'in' | 'out'): LandingFlush[] {
	const out: LandingFlush[] = [];
	for (let i = 1; i < snaps.length; i++) {
		const prev = snaps[i - 1].currentHasTabs;
		const cur = snaps[i].currentHasTabs;
		const flipped = dir === 'in' ? !prev && cur : prev && !cur;
		if (!flipped) continue;
		out.push({
			t: snaps[i].t,
			morph: snaps[i].morph,
			settling: snaps[i].settling
		});
	}
	return out;
}

/** A single slide's worth of probe entries where the rAF settle was actively
 *  animating the morph on `sourcePath` (the source route during the slide).
 *  Returns the count of distinct contiguous runs (one per slide on
 *  `sourcePath`); each run is a settling episode where the morph was
 *  mid-transition. The slide runs concurrently with the page track, so while
 *  `path === sourcePath` (the route has not landed yet) the settle rAF publishes
 *  intermediate `settleProgress` values that drive the morph derivation.
 *  `midMorphRange` filters to entries where the morph is genuinely between the
 *  endpoints (not the armed-at-start value), proving the rAF ticked. */
function slideAnimationRuns(
	snaps: HeaderSnap[],
	sourcePath: string,
	midMorphRange: { min: number; max: number } = { min: 0.1, max: 0.9 }
): HeaderSnap[][] {
	const runs: HeaderSnap[][] = [];
	let current: HeaderSnap[] = [];
	for (const s of snaps) {
		const inSlide =
			s.path === sourcePath &&
			s.settling &&
			s.morph > midMorphRange.min &&
			s.morph < midMorphRange.max;
		if (inSlide) {
			current.push(s);
		} else if (current.length > 0) {
			runs.push(current);
			current = [];
		}
	}
	if (current.length > 0) runs.push(current);
	return runs;
}

/** External computed-px documentary sequence across a path-change index:
 *  collapsed run-length encoding so a smooth descent reads as many small steps
 *  and a jump reads as one big step. Window-sensitive (rAF drops frames during
 *  the nav commit), so this is documentary only - assertions use `landings`. */
function externalSeq(frames: SettleFrame[], at: number): string {
	const lo = Math.max(0, at - 2);
	const hi = Math.min(frames.length, at + 22);
	const vals = frames.slice(lo, hi).map((f) => (f.rootComputedPx === null ? '?' : String(Math.round(f.rootComputedPx))));
	const out: string[] = [];
	let cur = vals[0];
	let n = 1;
	for (let i = 1; i < vals.length; i++) {
		if (vals[i] === cur) n++;
		else {
			out.push(n > 1 ? `${cur}×${n}` : `${cur}`);
			cur = vals[i];
			n = 1;
		}
	}
	out.push(n > 1 ? `${cur}×${n}` : `${cur}`);
	return out.join(' → ');
}

/** Drive one messages→bookmarks→messages cycle. The back leg clicks the header
 * back arrow (isDeep → onBack), the user's exact entry. */
async function runCycle(page: Page, dwell: number): Promise<void> {
	await page.locator('header button').first().click();
	await page.waitForTimeout(250); // drawer slide-in
	// Two a[href="/bookmarks"]: a CSS-hidden sidebar icon and the drawer's
	// UserInfoBlock text link. Pick the visible one.
	const bm = page.locator('a[href="/bookmarks"]').filter({ visible: true }).first();
	await bm.waitFor({ state: 'visible', timeout: 4000 });
	await bm.click();
	await page.waitForURL('/bookmarks', { timeout: 6000 });
	await page.waitForTimeout(dwell);
	await page.locator('header button').first().click(); // back arrow
	await page.waitForURL('/messages/inbox', { timeout: 6000 });
	await page.waitForTimeout(250);
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(150_000);

const BACK_CYCLES = Number(process.env.BACK_CYCLES ?? 6);

test('CALIBRATION: forward and back descents both keep their transition (documents the symmetry)', async ({
	page
}) => {
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(400);
	await installSampler(page);

	await runCycle(page, 250);

	const frames = await stopAndRead(page);
	const snaps = await readHeaderLog(page);
	const changes = pathChangeIndices(frames);
	const fwdAt = changes.find((at) => frames[at - 1].path === '/messages/inbox' && frames[at].path === '/bookmarks');
	const backAt = changes.find((at) => frames[at - 1].path === '/bookmarks' && frames[at].path === '/messages/inbox');

	const fwdOut = landings(snaps, 'out');
	const backIn = landings(snaps, 'in');
	const fwdLanding = fwdOut[0];
	// Back: the orchestrator intercepts the deep->tab nav and arms the settle
	// rAF CONCURRENTLY with the slide, so the descent animates DURING the
	// slide (path is still the source route). One contiguous run of
	// settling+mid-morph entries on /bookmarks per back slide.
	const backSlideRuns = slideAnimationRuns(snaps, '/bookmarks');

	console.log(`forward external seq: ${fwdAt ? externalSeq(frames, fwdAt) : 'n/a'}`);
	console.log(`back     external seq: ${backAt ? externalSeq(frames, backAt) : 'n/a'}`);
	console.log(`forward landing flush:`, fwdLanding);
	console.log(`back    slide runs:`, backSlideRuns.length);

	expect(fwdLanding, 'forward landing flush captured').toBeDefined();
	// Forward: the orchestrator does not intercept tab -> non-tab-root deep,
	// so the settle is armed at the landing flush by the idle title-change
	// arm. The rAF must be active at that flush.
	expect((fwdLanding as LandingFlush).settling, 'forward landing arms the settle rAF').toBe(true);
	// Back: the orchestrator intercepts the deep -> tab nav and arms the
	// settle rAF concurrent with the slide. The morph must animate during
	// the slide (settling === true with intermediate morph on the source
	// route, before the navigation lands).
	expect(
		backSlideRuns.length,
		'back slide animates the morph via the settle rAF during the slide'
	).toBeGreaterThanOrEqual(1);
});

test(`DEFECT: back descent from a NavPipelineHost deep page to a tab route animates via the settle rAF during the slide (${BACK_CYCLES} cycles)`, async ({
	page
}) => {
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(400);
	await installSampler(page);

	for (let i = 0; i < BACK_CYCLES; i++) {
		await runCycle(page, 150 + Math.round(Math.random() * 300));
	}

	const frames = await stopAndRead(page);
	const snaps = await readHeaderLog(page);
	const changes = pathChangeIndices(frames);
	const backObserved = changes.filter(
		(at) => frames[at - 1].path === '/bookmarks' && frames[at].path === '/messages/inbox'
	).length;
	const backRuns = slideAnimationRuns(snaps, '/bookmarks');

	console.log(`observed ${backObserved} back path-changes, ${backRuns.length} back slide runs`);
	for (const run of backRuns) {
		const first = run[0];
		const last = run[run.length - 1];
		console.log(
			`  back slide t=${Math.round(first.t)}..${Math.round(last.t)} entries=${run.length} morph ${first.morph.toFixed(2)} -> ${last.morph.toFixed(2)}`
		);
	}

	expect(backObserved, 'captured a back path-change per cycle').toBeGreaterThanOrEqual(BACK_CYCLES - 1);

	// Every back slide must arm the settle rAF and animate the morph during the
	// slide (no static snap). A regression that arms the settle only at the
	// navigation landing (after the slide completes) lands zero
	// settling+mid-morph entries on the source path during the slide; a
	// regression that drops the arm entirely leaves the same shape.
	expect(
		backRuns.length,
		`every back slide must animate the morph via the settle rAF during the slide. got ${backRuns.length} runs across ${backObserved} observed back navs`
	).toBeGreaterThanOrEqual(BACK_CYCLES - 1);

	// Trajectory: the descent must animate through real intermediate computed
	// translateY values, not a single-frame jump. The slide-runs check above
	// proves the rAF owns the descent via the probe; this proves the tabs layer
	// actually moved. A regression where the rAF never publishes intermediate
	// `settleProgress` values (zero intermediate delta) leaves zero values in
	// the (-38, -2) px band and fails here. `installSampler` records the live
	// m42 every animation frame.
	const intermediatePx = new Set<number>();
	for (const f of frames) {
		const px = f.rootComputedPx;
		if (px !== null && px > -38 && px < -2) intermediatePx.add(Math.round(px));
	}
	expect(
		intermediatePx.size,
		`back descent must animate through intermediate computed translateY values (not a single-frame jump). distinct intermediate px: ${[...intermediatePx].sort((a, b) => a - b).join(',')}`
	).toBeGreaterThanOrEqual(4);
});
