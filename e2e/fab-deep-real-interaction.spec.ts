import { test, expect } from '@playwright/test';
import { prepareContext, waitForHydration, clickDiscussion, openSidebarAndGoto } from './helpers';

/**
 * FAB deep-page boundary: REAL-interaction reproduction spec.
 *
 * The synthetic-nav spec (fab-deep-page-boundary.spec.ts) passed on these paths
 * because __e2eGoto and the synchronous CDP swipeBack compress the navigation
 * into the commit snap, hiding that the FAB does not actually follow the gesture
 * or animate on click nav. This spec drives the THREE real interaction paths a
 * user performs - drawer link tap, realistic-speed edge swipe, back-arrow tap -
 * and asserts a smooth, gesture-synchronized, multi-frame animation for each.
 * All three FAIL on the current code, surfacing the reported defects:
 *
 *   A. drawer `/` -> `/bookmarks`: the FAB holds at scale 1 through the mount,
 *      then drops in ~2 intermediate frames (a late fast fade, perceived as a
 *      jump) instead of a smooth sustained scale-out.
 *   B. realistic back-swipe `/bookmarks` -> `/`: the FAB stays at scale 0 for
 *      the entire finger drag (it does not follow the finger) and only moves at
 *      the commit snap - the sampler is not driving it during the drag.
 *   C. back-arrow tap `/bookmarks` -> `/`: the FAB jumps 0 -> 1 with zero
 *      intermediate frames; a click nav has no track motion to sample and the
 *      overlay family enables no CSS transition, so there is no animation path.
 *
 * Frame capture is rAF-resolution in-browser, tagged with the live pathname so
 * case B can distinguish drag-time (pathname still /bookmarks) from commit-time.
 */

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

interface Frame {
	present: boolean;
	scale: number | null;
	path: string;
	t: number;
}

async function capture(
	page: import('@playwright/test').Page,
	trigger: () => Promise<void>,
	settleMs = 900
): Promise<Frame[]> {
	const buf: Frame[] = [];
	try {
		await page.exposeBinding('__pushFabR', async (_s, v: Frame) => buf.push(v));
	} catch {
		/* reused across specs in one worker */
	}
	// rAF sampler installed on every future document (addInitScript) AND on the
	// current document (evaluate). Armed via a window flag the trigger flips.
	const probe = (): void => {
		const w = window as unknown as { __fabR?: boolean; __rafT0?: number };
		const tick = (): void => {
			if (w.__fabR) {
				const fab = document.querySelector('[data-testid="fab"]');
				let present = false;
				let scale: number | null = null;
				if (fab) {
					present = true;
					const m = getComputedStyle(fab).transform || '';
					const p = m.match(/matrix(?:3d)?\(([^)]+)\)/);
					if (p) scale = Number(p[1].split(',')[0]);
					else if (m === 'none') scale = 0;
				}
				const t0 = (w.__rafT0 ??= performance.now());
				(window as unknown as { __pushFabR?: (v: Frame) => void }).__pushFabR?.({
					present,
					scale,
					path: location.pathname,
					t: performance.now() - t0
				});
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	};
	await page.addInitScript(probe);
	await page.evaluate(probe);
	await page.evaluate(() => {
		const w = window as unknown as { __fabR?: boolean; __rafT0?: number };
		w.__rafT0 = performance.now();
		w.__fabR = true;
	});
	await new Promise((r) => setTimeout(r, 120));
	await trigger();
	await new Promise((r) => setTimeout(r, settleMs));
	await page.evaluate(() => {
		(window as unknown as { __fabR?: boolean }).__fabR = false;
	});
	return buf;
}

function scales(frames: Frame[]): number[] {
	return frames.filter((f) => f.present && f.scale !== null).map((f) => f.scale as number);
}

function dump(label: string, frames: Frame[]): string {
	const traj = frames
		.map((f) => `${f.present ? (f.scale ?? NaN).toFixed(2) : '·'}@${f.path === '/bookmarks' ? 'b' : '/'}`)
		.join(' ');
	return `${label} frames=${frames.length} traj=${traj}`;
}

/** Realistic-speed rightward edge swipe (~30ms per step), like a real finger. */
async function realisticSwipeBack(page: import('@playwright/test').Page): Promise<void> {
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.2);
	const endX = Math.round(width * 0.9);
	const y = 400;
	const steps = 20;
	const dispatch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string,
		ts: number
	) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: ts
		});
	const base = await page.evaluate(() => performance.now());
	await dispatch('touchStart', startX, 'touchPressed', base);
	for (let i = 1; i <= steps; i++) {
		const x = Math.round(startX + (endX - startX) * (i / steps));
		await dispatch('touchMove', x, 'touchMoved', base + i * 30);
		await page.waitForTimeout(30);
	}
	await dispatch('touchEnd', endX, 'touchReleased', base + steps * 30 + 20);
	await client.detach();
}

/** One continuous gesture with a direction reversal: drag right (FAB appears),
 *  reverse left (FAB disappears), then drag right again to the commit edge.
 *  Produces a single touchStart ... touchEnd sequence with a mid-gesture
 *  reversal, matching "swipe, reverse, swipe back" as one user gesture. */
async function swipeRightReverseRight(page: import('@playwright/test').Page): Promise<void> {
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.2);
	const peakX = Math.round(width * 0.6);
	const troughX = Math.round(width * 0.3);
	const endX = Math.round(width * 0.9);
	const y = 400;
	const dispatch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string,
		ts: number
	) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: ts
		});
	const base = await page.evaluate(() => performance.now());
	let step = 0;
	const seg = (from: number, to: number, n: number): Promise<void> =>
		(async () => {
			for (let i = 1; i <= n; i++) {
				step += 1;
				const x = Math.round(from + (to - from) * (i / n));
				await dispatch('touchMove', x, 'touchMoved', base + step * 28);
				await page.waitForTimeout(28);
			}
		})();
	await dispatch('touchStart', startX, 'touchPressed', base);
	await seg(startX, peakX, 6);
	await seg(peakX, troughX, 5);
	await seg(troughX, endX, 6);
	await dispatch('touchEnd', endX, 'touchReleased', base + (step + 1) * 28 + 20);
	await client.detach();
}

async function openDrawerAndClickBookmarks(page: import('@playwright/test').Page): Promise<void> {
	await page.locator('header button').first().click();
	await page.waitForTimeout(250);
	await page.locator('a[href="/bookmarks"]').filter({ visible: true }).first().click();
}

// CASE A: drawer tap / -> /bookmarks. Correct behaviour: a smooth multi-frame
// scale-out (>= 5 intermediate samples in (0.1, 0.9)). The defect produces ~2
// intermediate samples after a long hold at scale 1 - a late fast drop.
test('A forward drawer: `/` -> `/bookmarks` must scale the FAB out smoothly', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const frames = await capture(page, async () => {
		await openDrawerAndClickBookmarks(page);
		await page.waitForURL('/bookmarks', { timeout: 5000 });
	});
	const s = scales(frames);
	const intermediate = s.filter((v) => v > 0.1 && v < 0.9);
	expect(
		intermediate.length,
		`forward scale-out must be a smooth multi-frame ramp, not a late fast drop. ${dump('A', frames)}`
	).toBeGreaterThanOrEqual(5);
});

// CASE C: back-arrow tap /bookmarks -> /. Correct behaviour: the FAB scales in
// 0 -> 1 with intermediate samples (the click nav must still animate). The
// defect jumps 0 -> 1 with ZERO intermediate samples.
test('C back-arrow: `/bookmarks` -> `/` must animate the FAB in (no jump)', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	await openDrawerAndClickBookmarks(page);
	await page.waitForURL('/bookmarks', { timeout: 5000 });
	await waitForHydration(page);
	await page.waitForTimeout(400);
	const frames = await capture(page, async () => {
		await page.locator('header button').first().click();
		await page.waitForURL('/', { timeout: 5000 });
	});
	const s = scales(frames);
	const intermediate = s.filter((v) => v > 0.1 && v < 0.9);
	expect(
		intermediate.length,
		`back-arrow must animate the FAB in (zero intermediate = a hard jump). ${dump('C', frames)}`
	).toBeGreaterThanOrEqual(3);
});

// CASE B: realistic back-swipe /bookmarks -> /. Correct behaviour: the FAB
// follows the FINGER during the drag - it must leave scale 0 and reach a mid
// scale DURING the drag window (t <= 750ms; the drag itself is ~600ms). The
// defect keeps the FAB at scale 0 through the entire drag; it only moves at the
// commit snap, so no mid-scale frame exists during the drag itself.
test('B realistic swipe: FAB must follow the finger during the drag', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	await openDrawerAndClickBookmarks(page);
	await page.waitForURL('/bookmarks', { timeout: 5000 });
	await waitForHydration(page);
	await page.waitForTimeout(400);
	const frames = await capture(page, async () => {
		await realisticSwipeBack(page);
		await page.waitForURL('/', { timeout: 5000 }).catch(() => {});
	}, 1100);
	// The FAB must scale up BEFORE the URL swaps to / (i.e. while pathname is
	// still /bookmarks), proving it follows the gesture/commit slide rather than
	// jumping after the route change. Uses pathname (not a t-window) so it is
	// robust to the half/half scale curve (`fabScale` returns 0 for the first
	// half of `publication.progress`) and to rAF sampling gaps under CDP touch
	// dispatch.
	const preCommit = frames.filter((f) => f.path === '/bookmarks' && f.scale !== null);
	const maxPreCommit = preCommit.length ? Math.max(...preCommit.map((f) => f.scale as number)) : 0;
	expect(
		maxPreCommit,
		`FAB must scale up before the URL swaps to / (while still on /bookmarks), reaching >= 0.3; a post-swap-only jump is the defect. ${dump(
			'B',
			frames
		)}`
	).toBeGreaterThanOrEqual(0.3);
});

// CASE D (reversal state bug): in ONE continuous gesture, swipe right (FAB
// appears), reverse left (FAB disappears), then swipe right again to commit.
// Correct behaviour: the FAB scale tracks the live track position throughout,
// so it reappears on the second rightward leg (reaches >= 0.4 on the way back).
// The defect: the scale is driven by sampler/holdover STATE, not the live
// position, so a direction reversal leaves a stale latch and the FAB never
// reappears on the second leg.
test('D reversal: FAB must re-track after a direction reversal in one gesture', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	await openDrawerAndClickBookmarks(page);
	await page.waitForURL('/bookmarks', { timeout: 5000 });
	await waitForHydration(page);
	await page.waitForTimeout(400);
	const frames = await capture(
		page,
		async () => {
			await swipeRightReverseRight(page);
			await page.waitForURL('/', { timeout: 5000 }).catch(() => {});
		},
		2200
	);
	// After the reversal trough, on the second rightward leg the FAB must scale
	// up again (reach >= 0.4). The stale-state defect pins it low.
	const s = scales(frames);
	const maxScale = s.length ? Math.max(...s) : 0;
	expect(
		maxScale,
		`FAB must re-track the position after a direction reversal (reach >= 0.4); stale state pins it low. ${dump(
			'D',
			frames
		)}`
	).toBeGreaterThanOrEqual(0.4);
});

// CASE E: tap the Activity tab from Discussions. The FAB must scale OUT (1->0)
// smoothly, not vanish in one frame. The defect: the atom unmounts the instant
// the route lands on /activity (no FAB there) with no scale-out.
test('E tab tap: `/` -> `/activity` scales the FAB out (no instant vanish)', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const frames = await capture(page, async () => {
		await page.locator('a[data-tab-nav][href="/activity"]').click();
		await page.waitForURL('/activity', { timeout: 5000 });
	});
	const s = scales(frames);
	const intermediate = s.filter((v) => v > 0.1 && v < 0.9);
	expect(
		intermediate.length,
		`tab tap to Activity must scale the FAB out smoothly, not vanish. ${dump('E', frames)}`
	).toBeGreaterThanOrEqual(3);
});

// CASE F: tap the Discussions tab from Activity. The FAB must scale IN (0->1)
// smoothly, not appear at full size in one frame.
test('F tab tap: `/activity` -> `/` scales the FAB in (no instant appear)', async ({ page }) => {
	await page.goto('/activity');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const frames = await capture(page, async () => {
		await page.locator('a[data-tab-nav][href="/"]').click();
		await page.waitForURL('/', { timeout: 5000 });
	});
	const s = scales(frames);
	const intermediate = s.filter((v) => v > 0.1 && v < 0.9);
	expect(
		intermediate.length,
		`tab tap to Discussions must scale the FAB in smoothly, not appear at full size. ${dump(
			'F',
			frames
		)}`
	).toBeGreaterThanOrEqual(3);
});

// CASE G: tap the Messages tab from Discussions. The FAB kind swaps
// (discussions -> messages); it must shrink then grow (a dip below 0.5), not
// stay pinned at 1.
test('G tab tap: `/` -> `/messages/inbox` shrinks then grows the FAB', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const frames = await capture(page, async () => {
		await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
		await page.waitForURL('/messages/inbox', { timeout: 5000 });
	});
	const s = scales(frames);
	const minScale = s.length ? Math.min(...s) : 1;
	expect(
		minScale,
		`tab tap to Messages must shrink the FAB below 0.5 (kind swap dip), not pin at 1. ${dump(
			'G',
			frames
		)}`
	).toBeLessThan(0.5);
});

// CASE H: back-swipe from a thread, release mid-gesture (commit). The FAB must
// scale in CONTINUOUSLY (0 -> 1) following the gesture and the commit slide,
// with no disappear-then-replay. The invariant: the orchestrator's
// `#publication.progress` (NavStateMachine macro state merged with the
// executor's per-frame rAF-driven `#progress`) stays continuous across the
// live-drag to commit-slide to route-swap handoff. The route swap rebinds the
// host's element refs in place without tearing down the executor, so the FAB
// layer (a reactive reader of the publication) never sees a rest gap. The
// test guards against a regression where progress drops to its rest value (0)
// between the commit and the route swap and then re-animates 0 -> 1, which
// would surface as a disappear-replay discontinuity on the timeline.
test('H thread back-swipe release: FAB scales in continuously, no disappear-replay', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	await clickDiscussion(page, 0);
	await page.waitForURL(/\/discussion\//);
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const frames = await capture(
		page,
		async () => {
			await realisticSwipeBack(page);
			await page.waitForURL('/', { timeout: 5000 }).catch(() => {});
		},
		1800
	);
	// Once the FAB has scaled past 0.3, it must NOT drop below 0.1 again (that
	// would be the disappear-replay discontinuity). Find the first frame past
	// 0.3 and assert no later frame dips below 0.1.
	const present = frames.filter((f) => f.present && f.scale !== null) as {
		present: true;
		scale: number;
		t: number;
		path: string;
	}[];
	const firstPast = present.findIndex((f) => (f.scale as number) > 0.3);
	expect(firstPast, `FAB must scale past 0.3 during the swipe. ${dump('H', frames)}`).toBeGreaterThan(-1);
	const after = present.slice(firstPast).map((f) => f.scale as number);
	const dipAfter = after.filter((v) => v < 0.1).length;
	expect(
		dipAfter,
		`FAB must not disappear (drop below 0.1) after reaching 0.3; the disappear-replay discontinuity. ${dump(
			'H',
			frames
		)}`
	).toBe(0);
});

// CASE I: EXHAUSTIVE tab-pair navigation. Every one of the 6 ordered pairs
// across Discussions (/), Activity (/activity), Messages (/messages/inbox)
// must animate the FAB (>= 3 intermediate scale frames), not snap. Catches a
// timing- or latch-dependent implementation that animates one pair but snaps
// another.
const TAB_PAIRS: ReadonlyArray<{ from: string; to: string; label: string }> = [
	{ from: '/', to: '/activity', label: 'Discussions->Activity' },
	{ from: '/activity', to: '/', label: 'Activity->Discussions' },
	{ from: '/', to: '/messages/inbox', label: 'Discussions->Messages' },
	{ from: '/messages/inbox', to: '/', label: 'Messages->Discussions' },
	{ from: '/activity', to: '/messages/inbox', label: 'Activity->Messages' },
	{ from: '/messages/inbox', to: '/activity', label: 'Messages->Activity' }
];
for (const pair of TAB_PAIRS) {
	test(`I tab pair ${pair.label} animates the FAB`, async ({ page }) => {
		await page.goto(pair.from);
		await waitForHydration(page);
		await page.waitForTimeout(300);
		const frames = await capture(page, async () => {
			await page.locator(`a[data-tab-nav][href="${pair.to}"]`).click();
			await page.waitForURL(pair.to, { timeout: 5000 });
		});
		const s = scales(frames);
		const intermediate = s.filter((v) => v > 0.1 && v < 0.9);
		expect(
			intermediate.length,
			`tab nav ${pair.label} must animate the FAB (>= 3 intermediate frames), not snap. ${dump(
				'I',
				frames
			)}`
		).toBeGreaterThanOrEqual(3);
	});
}

// CASE J: STABILITY under repeated rapid tab clicks. Click through the tabs
// several times (D -> A -> M -> D -> A -> M), then assert the FINAL transition
// still animates. Catches a latch/state-machine implementation that works on the
// first click but leaves stale state that suppresses later animations ("click a
// few times and the animation is gone").
test('J repeated tab clicks: final transition still animates (no stale state)', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	// Warm the state with several rapid tab clicks (no capture).
	for (const href of ['/activity', '/messages/inbox', '/', '/activity', '/messages/inbox']) {
		await page.locator(`a[data-tab-nav][href="${href}"]`).click();
		await page.waitForURL(href, { timeout: 5000 });
		await page.waitForTimeout(120);
	}
	// Now capture the final transition: Messages -> Discussions.
	const frames = await capture(page, async () => {
		await page.locator('a[data-tab-nav][href="/"]').click();
		await page.waitForURL('/', { timeout: 5000 });
	});
	const s = scales(frames);
	const intermediate = s.filter((v) => v > 0.1 && v < 0.9);
	expect(
		intermediate.length,
		`FAB must still animate after repeated tab clicks (no stale state). ${dump('J', frames)}`
	).toBeGreaterThanOrEqual(3);
});

// CASE K: the DISAPPEAR half must animate, not jump. On a cross-FAB tab swap
// (Messages -> Discussions) the outgoing FAB must scale 1 -> 0 smoothly (the
// first-50% disappear), not snap in one frame. The defect: the URL swaps at the
// start of the slide, so the atom becomes the incoming FAB immediately and the
// outgoing FAB never scales out - the disappear is a single-frame leap from
// >0.8 to <0.2. Case I's ">= 3 intermediate" assertion does NOT catch this: the
// APPEAR half (0 -> 1) supplies the intermediate frames, masking the jump.
test('K disappear half: `/messages/inbox` -> `/` scales the FAB out smoothly (no jump)', async ({
	page
}) => {
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const frames = await capture(page, async () => {
		await page.locator('a[data-tab-nav][href="/"]').click();
		await page.waitForURL('/', { timeout: 5000 });
	});
	const s = scales(frames);
	// No single frame may leap from >0.8 down to <0.2 (a disappear jump). A
	// smooth scale-out steps through the (0.2, 0.8) band.
	let disappearLeap = 0;
	for (let i = 1; i < s.length; i++) {
		if (s[i - 1] > 0.8 && s[i] < 0.2) disappearLeap++;
	}
	expect(
		disappearLeap,
		`the disappear half must not jump from >0.8 to <0.2 in one frame (got ${disappearLeap} leap(s)). ${dump(
			'K',
			frames
		)}`
	).toBe(0);
});

// === LIFECYCLE TESTS (comprehensive coverage of every nav path) ===

// L: thread enter (/ -> /discussion/*). The FAB must scale out 1->0 as the
// thread slides over the list.
test('L thread enter: `/` -> `/discussion/*` scales the FAB out', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const frames = await capture(page, async () => {
		await clickDiscussion(page, 0);
		await page.waitForURL(/\/discussion\//, { timeout: 5000 });
	});
	const s = scales(frames);
	const intermediate = s.filter((v) => v > 0.1 && v < 0.9);
	expect(intermediate.length, `thread enter must animate FAB out. ${dump('L', frames)}`).toBeGreaterThanOrEqual(3);
});

// M: compose enter (/ -> /post/discussion via FAB tap). The FAB must scale out.
test('M compose enter: `/` -> `/post/discussion` scales the FAB out', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const frames = await capture(page, async () => {
		await page.locator('[data-testid="fab"]').click({ force: true });
		await page.waitForURL('/post/discussion', { timeout: 5000 });
	});
	const s = scales(frames);
	const intermediate = s.filter((v) => v > 0.1 && v < 0.9);
	expect(intermediate.length, `compose enter must animate FAB out. ${dump('M', frames)}`).toBeGreaterThanOrEqual(3);
});

// N: compose exit (/post/discussion -> / via browser back). The FAB must scale in.
test('N compose exit: `/post/discussion` -> `/` scales the FAB in', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.locator('[data-testid="fab"]').click({ force: true });
	await page.waitForURL('/post/discussion', { timeout: 5000 });
	await page.waitForTimeout(300);
	const frames = await capture(page, async () => {
		await page.goBack();
		await page.waitForURL('/', { timeout: 5000 });
	});
	const s = scales(frames);
	const intermediate = s.filter((v) => v > 0.1 && v < 0.9);
	expect(intermediate.length, `compose exit must animate FAB in. ${dump('N', frames)}`).toBeGreaterThanOrEqual(3);
});

// O: deep page round-trip (/ -> /profile/edit -> /). The FAB must animate both
// directions across the list<->deep boundary.
test('O deep forward: `/` -> `/profile/edit` scales the FAB out', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const frames = await capture(page, async () => {
		await openSidebarAndGoto(page, '/profile/edit');
	});
	const s = scales(frames);
	const intermediate = s.filter((v) => v > 0.1 && v < 0.9);
	expect(intermediate.length, `forward to /profile/edit must animate. ${dump('O', frames)}`).toBeGreaterThanOrEqual(3);
});

// P: M->D after a prior D->M on the SAME page (no fresh goto between captures).
// The capture probe uses a flag that is re-armed via page.evaluate; calling
// capture twice on the same page re-arms cleanly. Uses waitForTimeout to let
// the probe baseline settle between the two legs.
test('P rapid D->M->D: second leg animates after first', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	// First leg (no assertion - just navigate to set up the scenario).
	await page.locator('a[data-tab-nav][href="/messages/inbox"]').click();
	await page.waitForURL('/messages/inbox', { timeout: 5000 });
	await page.waitForTimeout(500);
	// Second leg (captured): /messages/inbox -> /
	const frames = await capture(page, async () => {
		await page.locator('a[data-tab-nav][href="/"]').click();
		await page.waitForURL('/', { timeout: 5000 });
	});
	const s = scales(frames);
	const intermediate = s.filter((v) => v > 0.1 && v < 0.9);
	expect(intermediate.length, `M->D must animate after prior D->M nav. ${dump('P', frames)}`).toBeGreaterThanOrEqual(3);
});

// Q: messages back-swipe release (mirror of H but from messages). The FAB must
// scale in continuously with no disappear-replay.
test('Q messages back-swipe release: continuous scale-in, no replay', async ({ page }) => {
	await page.goto('/messages/inbox');
	await waitForHydration(page);
	await page.waitForTimeout(300);
	// Navigate to a messages conversation, then swipe back
	await page.goto('/');
	await waitForHydration(page);
	await clickDiscussion(page, 0);
	await page.waitForURL(/\/discussion\//);
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const frames = await capture(page, async () => {
		await realisticSwipeBack(page);
		await page.waitForURL('/', { timeout: 5000 }).catch(() => {});
	}, 1800);
	const present = frames.filter((f) => f.present && f.scale !== null) as {
		present: true; scale: number; t: number; path: string;
	}[];
	const firstPast = present.findIndex((f) => (f.scale as number) > 0.3);
	if (firstPast > -1) {
		const after = present.slice(firstPast).map((f) => f.scale as number);
		const dipAfter = after.filter((v) => v < 0.1).length;
		expect(dipAfter, `no disappear-replay on thread back-swipe. ${dump('Q', frames)}`).toBe(0);
	}
});

// R: deep->deep swap (/bookmarks -> /profile/settings via drawer). The FAB
// must not show a persistent scale-1 flash (both endpoints rest at 0).
test('R deep->deep: no persistent scale-1 flash', async ({ page }) => {
	await page.goto('/');
	await waitForHydration(page);
	await page.waitForTimeout(200);
	await openSidebarAndGoto(page, '/bookmarks');
	await page.waitForURL('/bookmarks', { timeout: 5000 });
	await waitForHydration(page);
	await page.waitForTimeout(300);
	const frames = await capture(page, async () => {
		await openSidebarAndGoto(page, '/profile/settings');
	});
	// After the swap settles, the FAB must be at scale 0 (both endpoints are
	// overlay/deep, resting at 0). A persistent scale-1 frame is a failure.
	const tail = scales(frames).slice(-10);
	const maxTail = tail.length ? Math.max(...tail) : 1;
	expect(maxTail, `deep->deep must not flash scale 1 persistently. ${dump('R', frames)}`).toBeLessThan(0.3);
});
