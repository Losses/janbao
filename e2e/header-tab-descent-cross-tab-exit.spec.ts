import { test, expect, type Page } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

/**
 * Header tab-descent regression spec.
 *
 * The mobile Header's tabs layer sits at translateY(-100%) on a deep page and
 * descends to translateY(0%) when the route returns to a tab route (the "Tab
 * 下沉" animation). The descent is a CSS `transform 200ms ease-out` transition
 * on the layer; the value it animates toward is `morph`, derived in Header.svelte.
 *
 * The layer transition (`slideT` in Header.svelte) suppresses only during a live
 * drag or a root↔search tap scrub, where `morph` is driven 1:1 by the finger or
 * the scrubber. It does not suppress during an in-flight navigation, so the
 * back-to-tab landing descent animates the same way as the forward direction.
 * This is branch-agnostic: both GesturePageLayout exit branches (same-panel slide
 * and cross-tab chip) call setPendingNav → executePendingNav → navInFlight at the
 * landing, and the tabs layer animates there in both.
 *
 * The forward direction (tab route → deep page, e.g. /messages/inbox →
 * /bookmarks) animates the same way: the tab route does not mount
 * GesturePageLayout, navInFlight is never set, and the Effect-C settle drives
 * morph with the transition enabled.
 *
 * Tests:
 *   - CALIBRATION: documents the symmetry - the forward and the back landing
 *     flushes both keep the CSS transition (slideT !== 'none'), sampled via the
 *     internal per-flush probe window.__headerMorphProbe. navInFlight is asserted set
 *     at the back landing as a witness that the slideT gate is independent of
 *     the navInFlight signal.
 *   - DEFECT: across multiple messages↔bookmarks cycles the back landing flush
 *     must keep the transition (the gate never suppresses at a tab-root landing).
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
	navInFlight: boolean;
	pending: string | null;
}

interface SamplerWindow extends Window {
	__settleLog?: SettleFrame[];
	__settleStop?: boolean;
}

interface HeaderSnap {
	t: number;
	path: string;
	morph: number;
	slideT: string;
	settling: boolean;
	currentHasTabs: boolean;
	navInFlight: boolean;
	pendingNav: string | null;
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
		const g = window as unknown as {
			__navStore?: { navInFlight: boolean; pendingNav: { href: string } | null };
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
				rootTransition: root ? root.style.transition : '',
				navInFlight: g.__navStore ? g.__navStore.navInFlight : false,
				pending: g.__navStore && g.__navStore.pendingNav ? g.__navStore.pendingNav.href : null
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
	slideNone: boolean; // slideT contained 'none' at this flush
	navInFlight: boolean;
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
			slideNone: snaps[i].slideT.includes('none'),
			navInFlight: snaps[i].navInFlight
		});
	}
	return out;
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
	const backLanding = backIn[0];

	console.log(`forward external seq: ${fwdAt ? externalSeq(frames, fwdAt) : 'n/a'}`);
	console.log(`back     external seq: ${backAt ? externalSeq(frames, backAt) : 'n/a'}`);
	console.log(`forward landing flush:`, fwdLanding);
	console.log(`back    landing flush:`, backLanding);

	expect(fwdLanding, 'forward landing flush captured').toBeDefined();
	expect(backLanding, 'back landing flush captured').toBeDefined();
	// Symmetry: forward and back both keep the CSS transition at the landing
	// flush. navInFlight is set at the back landing (the slideT gate does not
	// read navInFlight; executePendingNav sets it regardless) - asserted as a
	// witness that the gate is independent of the navInFlight signal.
	expect((fwdLanding as LandingFlush).slideNone, 'forward landing keeps the transition').toBe(false);
	expect((backLanding as LandingFlush).slideNone, 'back landing keeps the transition').toBe(false);
	expect((backLanding as LandingFlush).navInFlight, 'back landing sets navInFlight').toBe(true);
});

test(`DEFECT: back descent from a GesturePageLayout deep page to a tab route must not suppress the transition at landing (${BACK_CYCLES} cycles)`, async ({
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
	const backIn = landings(snaps, 'in');
	const changes = pathChangeIndices(frames);
	const backObserved = changes.filter(
		(at) => frames[at - 1].path === '/bookmarks' && frames[at].path === '/messages/inbox'
	).length;

	console.log(`observed ${backObserved} back path-changes, ${backIn.length} back landing flushes`);
	for (const l of backIn) {
		console.log(`  back landing t=${Math.round(l.t)} morph=${l.morph.toFixed(2)} slideNone=${l.slideNone} navInFlight=${l.navInFlight}`);
	}

	expect(backIn.length, 'captured a back landing flush per cycle').toBeGreaterThanOrEqual(BACK_CYCLES - 1);

	// The slideT gate must not suppress at a back-to-tab landing flush, so the
	// descent animates. navInFlight is set at every GPL exit landing; the slideT
	// gate does not read it (the CALIBRATION `navInFlight===true` witness confirms
	// the signal is set at the landing).
	const suppressed = backIn.filter((l) => l.slideNone);
	expect(
		suppressed.length,
		`back landing must keep slideT animated (not 'none'). ${suppressed.length}/${backIn.length} landings suppressed the transition`
	).toBe(0);

	// Trajectory: the descent must animate through real intermediate computed
	// translateY values, not a single-frame jump. The `slideNone` check above
	// proves the transition is enabled (the string is not 'none'); this proves the
	// tabs layer actually moved. A regression where slideT stays '200ms' but the
	// transform commits in a single frame (zero intermediate delta) leaves zero
	// values in the (-38, -2) px band and fails here. `installSampler` records the
	// live m42 every animation frame.
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
