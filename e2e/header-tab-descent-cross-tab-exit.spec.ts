import { test, expect, type Page } from '@playwright/test';
import { prepareContext, waitForHydration } from './helpers';

/**
 * Header tab-descent regression spec — cross-tab exit boundary.
 *
 * The mobile Header's tabs layer sits at translateY(-100%) on a deep page and
 * descends to translateY(0%) when the route returns to a tab route (the "Tab
 * 下沉" animation). The descent is a CSS `transform 200ms ease-out` transition
 * on the layer; the value it animates toward is `morph`, derived in Header.svelte.
 *
 * The forward direction (tab route → deep page, e.g. /messages/inbox →
 * /bookmarks) animates smoothly. The BACK direction from a GesturePageLayout
 * deep page to a tab route (e.g. /bookmarks → /messages/inbox via the back
 * arrow) does NOT: the descent plays partially or not at all, then snaps to the
 * end. Users report it as "the tab descent animation freezes mid-way then jumps
 * to the end", intermittently.
 *
 * Root cause (confirmed by the internal per-flush probe in CALIBRATION):
 * GesturePageLayout's beforeNavigate intercepts the back nav, and because the
 * tab route is not one of the deep page's pre-rendered neighbour panels it takes
 * the CROSS-TAB EXIT path: cancel the SvelteKit nav, show a loading chip,
 * preload the target, then dispatch via navStore.executePendingNav(). That sets
 * `navInFlight = true` BEFORE the navigation lands. Header's layer transition is
 *
 *   slideT = (navInFlight && !settling) ? 'none' : 'transform 200ms ease-out'
 *
 * so when the nav commits and `morph` flips to its tab-rest value (1), the
 * layer's transition is 'none' and the transform jumps -100% → 0% with no
 * animation (or, when the morph flip and the navInFlight render land in separate
 * paints on slower devices, a partial descent that then snaps — the reported
 * freeze-then-jump). The forward direction is unaffected because the tab route
 * does not mount GesturePageLayout, so the cross-tab exit / navInFlight path is
 * never entered and slideT stays '200ms'.
 *
 * Tests:
 *   - CALIBRATION (passes): documents the measured asymmetry — forward handoff
 *     has many mid-air frames (smooth), back handoff has zero (jump), and the
 *     internal probe shows slideT === 'none' at the back landing flush.
 *   - DEFECT (fails on current code): asserts the back descent animates like the
 *     forward descent (mid-air frames present, no single-frame jump) and that
 *     slideT is NOT suppressed at the landing flush. Guards the fix.
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
	__headerLog?: HeaderSnap[];
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
		return w.__headerLog ?? [];
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
 *  the nav commit), so this is documentary only — assertions use `landings`. */
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

test('CALIBRATION: forward descent keeps its transition, back descent suppresses it (documents the asymmetry)', async ({
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
	// Documented current behaviour:
	expect((fwdLanding as LandingFlush).slideNone, 'forward landing keeps the transition').toBe(false);
	expect((backLanding as LandingFlush).slideNone, 'back landing suppresses the transition').toBe(true);
	expect((backLanding as LandingFlush).navInFlight, 'back landing has navInFlight set').toBe(true);
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

	// Desired behaviour (fails on current code): at the landing flush where the
	// layer commits to tabs-visible, the transition must NOT be suppressed. The
	// current cross-tab-exit path sets navInFlight before landing, which makes
	// slideT 'none' at exactly this flush, so the descent cannot animate.
	const suppressed = backIn.filter((l) => l.slideNone);
	expect(
		suppressed.length,
		`back landing must keep slideT animated (not 'none'). ${suppressed.length}/${backIn.length} landings suppressed the transition`
	).toBe(0);
});
