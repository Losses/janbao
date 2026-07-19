import { test, expect, type Page } from '@playwright/test';
import { prepareContext, waitForHydration, swipeBack } from './helpers';

/**
 * Deep→deep gesture-back morph-spike regression.
 *
 * The mobile Header's vertical morph (BurgerArrowIcon 0=hamburger/1=arrow +
 * the tabs layer translateY) animates between a tab page (morph 1) and a deep
 * page (morph 0). On a deep→deep navigation (e.g. /profile/edit →
 * /profile/settings, both deep) the morph must stay a constant 0 the whole way:
 * both endpoints are deep, so the icon stays an arrow and the tabs stay hidden.
 *
 * The gesture-commit settle (Header.svelte Effect B → `morph` derived branch 2,
 * the `awaitTitle` arm) computes `target = targetHasTabs ? 1 : 0` from the LIVE
 * `navStore.backTarget`. On a deep→deep commit the reveal target is deep
 * (target 0) DURING the gesture, but the moment the navigation lands,
 * `backTargetFor` re-derives from the new stack top: /profile/settings's back
 * target is '/' (a TAB), so `targetHasTabs` flips false→true mid-settle. With
 * `settling` still true, `settleProgress` already ≈1 and `target` now 1, the
 * settle arm returns `current*(1-p) + target*p` ≈ 1 → morph spikes to 1 for the
 * flush(es) before Effect C/D end the settle. The 200ms CSS transition on the
 * tabs layer + icon turns that one-frame internal spike into a visible
 * "arrow→hamburger→arrow" + "tabs sink down then float up" flicker.
 *
 * The back BUTTON does not spike: it is a popstate (no gesture), so Effect B
 * never fires and `morph` rests at `currentHasTabs ? 1 : 0` (= 0 on a deep
 * page) the entire time. The asymmetry between the gesture path (settle arm,
 * live target) and the click path (regular arm, prev/current) is the defect.
 *
 * The DEV-only `window.__headerMorphProbe` (Header.svelte) pushes a per-flush
 * snapshot of every morph-state dep on each reactive flush, paint-independent,
 * so it catches the spike frame even when the navigation commit blocks the main
 * thread between paints (a rAF sampler would drop it).
 */

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

// Mirror of src/lib/utils/header-probe.ts HeaderStateSnapshot (the probe is a
// DEV-only window sink; we re-declare the shape here so the node-side Playwright
// runner does not import app code).
interface HeaderSettleTransition {
	outgoingTitle: string;
	incomingTitle: string;
	outgoingHasTabs: boolean;
	incomingHasTabs: boolean;
}

interface HeaderSnap {
	t: number;
	path: string;
	morph: number;
	rootLayerStyle: string;
	layerDownStyle: string;
	settling: boolean;
	isSettleMode: boolean;
	settleProgress: number;
	settleAwaitTitle: boolean;
	lastGestureMorph: number;
	currentHasTabs: boolean;
	targetHasTabs: boolean;
	prevHasTabs: boolean;
	latchedSettle: HeaderSettleTransition | null;
	effectiveTabsOut: boolean;
	effectiveTabsIn: boolean;
	dragging: boolean;
	backMorph: number | null;
}

interface ProbeWindow extends Window {
	__headerMorphProbe?: HeaderSnap[];
}

async function readProbe(page: Page): Promise<HeaderSnap[]> {
	return page.evaluate(() => (window as unknown as ProbeWindow).__headerMorphProbe ?? []);
}

async function clearProbe(page: Page): Promise<void> {
	await page.evaluate(() => {
		(window as unknown as ProbeWindow).__headerMorphProbe = [];
	});
}

// A deep page is at morph 0 (icon arrow, tabs hidden). The morph must NEVER
// leave the deep rest band during a deep→deep gesture: the drag arm hardcodes 0
// (isDeepToDeep), the settle arm must hold 0, and the rest arm is 0. Any frame
// above this epsilon is the commit-landing spike.
const DEEP_MORPH_EPSILON = 0.25;

interface SpikeSummary {
	maxMorph: number;
	spikeFrames: HeaderSnap[];
	landingFrames: HeaderSnap[];
}

/** Summarise the morph trace over the frames that belong to this gesture
 *  (everything from the first drag/backMorph publish onward). `landingFrames`
 *  are the post-nav frames on the destination deep page - the spike lives there. */
function summarise(snaps: HeaderSnap[], sinceT: number): SpikeSummary {
	const active = snaps.filter((s) => s.t >= sinceT);
	let maxMorph = 0;
	const spikeFrames: HeaderSnap[] = [];
	const landingFrames: HeaderSnap[] = [];
	for (const s of active) {
		if (s.morph > maxMorph) maxMorph = s.morph;
		if (s.morph > DEEP_MORPH_EPSILON) spikeFrames.push(s);
		// Post-navigation frames on a deep destination where settling was in flight
		// (the window the spike occupies).
		if (!s.currentHasTabs && s.settling) {
			landingFrames.push(s);
		}
	}
	return { maxMorph, spikeFrames, landingFrames };
}

function fmt(s: HeaderSnap): string {
	return `t=${Math.round(s.t)} path=${s.path} morph=${s.morph.toFixed(3)} settling=${s.settling} settleProgress=${s.settleProgress.toFixed(2)} awaitTitle=${s.settleAwaitTitle} currentHasTabs=${s.currentHasTabs} targetHasTabs=${s.targetHasTabs}`;
}

// Drive the user's exact entry: / → /profile/settings → /profile/edit. Both
// /profile/* are GLOBAL_PREFIXES routes, so they inherit the active tab and
// stack as [/ , /profile/settings, /profile/edit]. Gesturing back from edit
// reveals /profile/settings (deep); landing there leaves '/' (a tab) as the new
// back target - the targetHasTabs false→true flip the spike needs.
async function enterEditProfile(page: Page): Promise<void> {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	await page.evaluate(
		(h) => (window as unknown as { __e2eGoto?: (h: string) => Promise<void> }).__e2eGoto!(h),
		'/profile/settings'
	);
	await page.waitForFunction(() => location.pathname === '/profile/settings', { timeout: 5000 });
	await page.waitForTimeout(250);
	await page.evaluate(
		(h) => (window as unknown as { __e2eGoto?: (h: string) => Promise<void> }).__e2eGoto!(h),
		'/profile/edit'
	);
	await page.waitForFunction(() => location.pathname === '/profile/edit', { timeout: 5000 });
	await page.waitForTimeout(300);
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

test('DEFECT: gesture-back /profile/edit → /profile/settings must not spike morph (deep→deep)', async ({
	page
}) => {
	await enterEditProfile(page);
	await clearProbe(page);
	const startT = await page.evaluate(() => performance.now());

	await swipeBack(page);
	await page.waitForFunction(() => location.pathname === '/profile/settings', { timeout: 6000 });
	// Hold past the 200ms CSS transition window so the full settle + recovery lands
	// in the trace.
	await page.waitForTimeout(700);

	const snaps = await readProbe(page);
	const sum = summarise(snaps, startT);

	console.log(`DEFECT trace: ${snaps.filter((s) => s.t >= startT).length} active frames`);
	console.log(`  maxMorph=${sum.maxMorph.toFixed(3)} spikeFrames=${sum.spikeFrames.length}`);
	for (const s of sum.spikeFrames.slice(0, 12)) console.log(`  SPIKE ${fmt(s)}`);

	// Witness: the gesture really happened and the destination deep page was
	// reached (else the assertion below is vacuous).
	expect(snaps.some((s) => s.dragging), 'a drag was observed').toBe(true);
	expect(
		snaps.filter((s) => s.t >= startT).some((s) => s.path === '/profile/settings'),
		'landed on /profile/settings'
	).toBe(true);

	// The defect: morph must never leave the deep rest band on a deep→deep
	// gesture. A spike > epsilon is the arrow→hamburger→arrow + tabs sink/float.
	expect(
		sum.spikeFrames.length,
		`deep→deep gesture spiked morph to ${sum.maxMorph.toFixed(3)} on ${sum.spikeFrames.length} frames (arrow→hamburger→arrow / tabs sink-then-float). Spike frames:\n${sum.spikeFrames.slice(0, 6).map(fmt).join('\n')}`
	).toBe(0);
});

test('CALIBRATION: back-button /profile/edit → /profile/settings keeps morph at 0 (asymmetry witness)', async ({
	page
}) => {
	await enterEditProfile(page);
	await clearProbe(page);
	const startT = await page.evaluate(() => performance.now());

	// The header back arrow (isDeep → onBack → history.back). Same destination
	// as the gesture test, reached the non-gesture way.
	await page.locator('header button').first().click();
	await page.waitForFunction(() => location.pathname === '/profile/settings', { timeout: 6000 });
	await page.waitForTimeout(500);

	const snaps = await readProbe(page);
	const sum = summarise(snaps, startT);

	console.log(`CALIBRATION trace: maxMorph=${sum.maxMorph.toFixed(3)} spikeFrames=${sum.spikeFrames.length}`);

	expect(
		snaps.filter((s) => s.t >= startT).some((s) => s.path === '/profile/settings'),
		'landed on /profile/settings'
	).toBe(true);
	// Same destination, no gesture: morph rests at 0 the whole way (no settle arm,
	// no live-target flip). This passing alongside the DEFECT failing is the
	// gesture/click asymmetry that makes the bug a gesture-only regression.
	expect(
		sum.maxMorph,
		`back-button path must not spike (maxMorph=${sum.maxMorph.toFixed(3)})`
	).toBeLessThan(DEEP_MORPH_EPSILON);
});

// Generalisation: the same deep→deep-with-tab-back shape exists under /admin
// (/admin/[sub] getParent → /admin, whose own getParent → '/'). Entering
// '/' → /admin → /admin/categories and gesturing back lands on /admin (deep)
// whose back target is '/' (tab) - identical targetHasTabs flip. If the DEFECT
// test fails here too, the bug is the architecture (every deep→deep commit),
// not a /profile oddity.
test('GENERALIZATION: gesture-back /admin/categories → /admin spikes the same way', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	for (const h of ['/admin', '/admin/categories']) {
		await page.evaluate(
			(href) => (window as unknown as { __e2eGoto?: (h: string) => Promise<void> }).__e2eGoto!(href),
			h
		);
		await page.waitForFunction((p) => location.pathname === p, h, { timeout: 5000 });
		await page.waitForTimeout(250);
	}

	await clearProbe(page);
	const startT = await page.evaluate(() => performance.now());
	await swipeBack(page);
	await page.waitForFunction(() => location.pathname === '/admin', { timeout: 6000 });
	await page.waitForTimeout(700);

	const snaps = await readProbe(page);
	const sum = summarise(snaps, startT);

	console.log(`GENERALIZATION trace: maxMorph=${sum.maxMorph.toFixed(3)} spikeFrames=${sum.spikeFrames.length}`);
	for (const s of sum.spikeFrames.slice(0, 8)) console.log(`  SPIKE ${fmt(s)}`);

	expect(
		snaps.filter((s) => s.t >= startT).some((s) => s.path === '/admin'),
		'landed on /admin'
	).toBe(true);
	expect(
		sum.spikeFrames.length,
		`deep→deep gesture under /admin spiked morph to ${sum.maxMorph.toFixed(3)} (same root cause as /profile)`
	).toBe(0);
});

// Positive symmetric guard to the spike tests. /profile/settings is a GPL-mounted
// deep route whose back target is '/' (a tab root), so a swipeBack here is a
// genuine gesture deep→tab COMMIT - the arm where latchedSettle.incomingHasTabs
// must be true so morph ramps toward 1 and the tabs layer descends.
// header-tab-descent-cross-tab-exit drives the back leg with a header-arrow CLICK
// and so does not exercise this arm;
// header-tabs-replay gesture-covers the same arm (swipeBackHalf /profile/settings
// → /messages/inbox) for its own no-snap-replay invariant. This test adds the
// latchedSettle commit-frame witness specific to the fix.
test('PRESERVE: gesture-back /profile/settings → / drives the deep→tab commit arm (tab descent)', async ({
	page
}) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	await page.evaluate(
		(h) => (window as unknown as { __e2eGoto?: (h: string) => Promise<void> }).__e2eGoto!(h),
		'/profile/settings'
	);
	await page.waitForFunction(() => location.pathname === '/profile/settings', { timeout: 5000 });
	await page.waitForTimeout(300);

	await clearProbe(page);
	const startT = await page.evaluate(() => performance.now());
	await swipeBack(page);
	await page.waitForFunction(() => location.pathname === '/', { timeout: 6000 });
	await page.waitForTimeout(700);

	const snaps = (await readProbe(page)).filter((s) => s.t >= startT);
	const peak = snaps.reduce((m, s) => Math.max(m, s.morph), 0);
	const commitFrame = snaps.find((s) => s.settling && s.morph >= 0.9);
	const distinctIntermediate = new Set(
		snaps.filter((s) => s.morph > 0.1 && s.morph < 0.9).map((s) => Math.round(s.morph * 10))
	);

	console.log(
		`PRESERVE trace: ${snaps.length} frames, peakMorph=${peak.toFixed(3)}, commitFrame=${commitFrame ? 'seen' : 'none'}, intermediateBuckets=${distinctIntermediate.size}`
	);

	expect(snaps.some((s) => s.path === '/'), 'landed on /').toBe(true);
	expect(
		commitFrame,
		'gesture deep→tab commit arm ran (settling && morph>=0.9; the latch drove the descent, not a spike)'
	).toBeDefined();
	expect(
		commitFrame && commitFrame.latchedSettle?.incomingHasTabs,
		'latchedSettle.incomingHasTabs=true at the deep→tab commit'
	).toBe(true);
	expect(
		distinctIntermediate.size,
		`deep→tab descent animated through intermediate morph values (not a single jump). buckets: ${[...distinctIntermediate].sort((a, b) => a - b).join(',')}`
	).toBeGreaterThanOrEqual(3);
});

// PREVENTIVE: the cause-pattern guard. During any settle the layer styles must
// source endpoint identity from the latched record (effectiveTabsOut/In), and
// every isSettleMode frame must have a non-null record (the arming same-flush
// invariant). A layer style reading live targetHasTabs during a deep→deep
// landing fails (b): live targetHasTabs=true but the record's incomingHasTabs is
// false.
test('PREVENTIVE: settling consumers source endpoint identity from the latched record', async ({
	page
}) => {
	await enterEditProfile(page);
	await clearProbe(page);
	const startT = await page.evaluate(() => performance.now());
	await swipeBack(page);
	await page.waitForFunction(() => location.pathname === '/profile/settings', { timeout: 6000 });
	await page.waitForTimeout(700);

	const snaps = (await readProbe(page)).filter((s) => s.t >= startT);

	// (a) The arming same-flush invariant: every isSettleMode frame has a record.
	const nullDuringSettle = snaps.filter((s) => s.isSettleMode && s.latchedSettle === null);
	// (b) Source attribution: the layer styles' effective tabs equal the record
	// while a settle is in flight (a live read on the deep→deep landing, where
	// live targetHasTabs=true but record incomingHasTabs=false, would diverge).
	const sourceDivergences = snaps.filter(
		(s) =>
			s.latchedSettle !== null &&
			(s.effectiveTabsIn !== s.latchedSettle.incomingHasTabs ||
				s.effectiveTabsOut !== s.latchedSettle.outgoingHasTabs)
	);

	console.log(
		`PREVENTIVE trace: ${snaps.length} frames, nullDuringSettle=${nullDuringSettle.length}, sourceDivergences=${sourceDivergences.length}`
	);

	expect(snaps.some((s) => s.dragging), 'a drag was observed').toBe(true);
	expect(
		snaps.some((s) => s.isSettleMode),
		'a settle frame was captured (else the assertions are vacuous)'
	).toBe(true);
	expect(nullDuringSettle.length, 'every isSettleMode frame has a non-null latchedSettle').toBe(0);
	expect(
		sourceDivergences.length,
		`layer styles sourced endpoint identity from the record during settle (no live read). divergent frames: ${sourceDivergences.length}`
	).toBe(0);
});
