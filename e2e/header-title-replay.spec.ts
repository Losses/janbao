import { test, expect, type Page } from '@playwright/test';
import { prepareContext, waitForHydration, openSidebarAndGoto } from './helpers';

/**
 * Header deep-title "instant swap + replay" on a back-swipe COMMIT.
 *
 * Reproduction (user report): on /profile/settings, open /profile/edit, start a
 * left-to-right (back) swipe, drag about halfway, release. At the instant of
 * release the outgoing and incoming titles swap in a single frame and the whole
 * title-crossfade then plays a second time.
 *
 * Root cause (see the audit report). The Header has TWO decoupled title render
 * paths keyed off the same deep-title container:
 *
 *   - DRAG branch   (pager.dragging === true): renders currentTitle (this page)
 *                   + incomingTitle (navStore.backTarget), both positioned live
 *                   by `morph` (pager.backMorph). No module state involved.
 *   - TRANSITION/STATIC branches (pager.dragging === false): render module-level
 *                   `prevTitle` + `displayedTitle`, driven by `transitionProgress`.
 *                   These only update when the `$effect` over `title` fires.
 *
 * On a back-swipe COMMIT, onSwipeEnd clears `dragOffset` synchronously, so the
 * GesturePageLayout pager effect flips `dragging` false + `backMorph` 1 BEFORE
 * the SvelteKit navigation has landed. `title` is still the source page's title,
 * so the title `$effect` has NOT fired → `titleTransitionActive` is false → the
 * Header drops from the DRAG branch (two titles, mid-crossfade) straight to the
 * STATIC branch (one title, `displayedTitle` = the SOURCE page). The incoming
 * title that was sliding in vanishes and the outgoing title snaps back to
 * centre: the "instant swap". ~200ms later the navigation lands, `title`
 * finally changes, the `$effect` re-triggers from `transitionProgress` 0→1, and
 * the full crossfade plays again: the "replay".
 *
 * Faithfulness: the swipe is a real CDP touch gesture (detectSwipe rejects
 * mouse), dragged to ~half width (morph ≈ 0.5, past SWIPE_COMMIT 60 so it
 * commits - matching "drag halfway, release"), with inter-move yields so the
 * rAF sampler catches the in-drag two-title state. /profile/edit is reached by
 * a real forward click off /profile/settings so the nav stack holds
 * [..., /profile/settings, /profile/edit] and backTarget resolves to
 * /profile/settings during the drag.
 */

// --- per-frame sampler of the deep-title layer -----------------------------
// The deep-title container is the title-slot child carrying `px-2`
// (layerDownStyle); the sibling root tab layer lacks px-2. Its child
// `span.truncate.text-center` nodes ARE the title spans - 2 while a crossfade
// is in flight (drag OR transition branch), 1 at rest (static branch). Sampling
// their count + text per frame captures the 2 -> 1 -> 2 collapse-and-replay
// signature directly.

interface TitleSpan {
	text: string;
	/** Inline transform of the span's positioned parent (translateY(...) string). */
	tf: string;
}

interface TitleFrame {
	t: number;
	path: string;
	spans: TitleSpan[];
}

interface TitleSamplerState {
	frames: TitleFrame[];
	done: boolean;
}

interface TitleSamplerWindow extends Window {
	__titleLog?: TitleSamplerState;
}

const TITLE_SELECTOR = 'header .relative.h-10.flex-1 > .px-2 span.truncate.text-center';
// page.evaluate callbacks run in the browser and cannot close over Node-side
// consts, so both values are passed in as the evaluate arg.
const SAMPLE_WINDOW_MS = 1600;

interface SamplerArgs {
	selector: string;
	windowMs: number;
}

async function installTitleSampler(page: Page): Promise<void> {
	await page.evaluate(
		(args) => {
			const w = window as unknown as TitleSamplerWindow;
			const state: TitleSamplerState = { frames: [], done: false };
			w.__titleLog = state;
			const start = performance.now();
			const tick = (): void => {
				const nodes = Array.from(document.querySelectorAll(args.selector)) as HTMLElement[];
				const spans: TitleSpan[] = nodes.map((n) => ({
					text: (n.textContent ?? '').trim(),
					tf: (n.parentElement?.style.transform ?? '').trim()
				}));
				state.frames.push({ t: Math.round(performance.now()), path: location.pathname, spans });
				if (performance.now() - start > args.windowMs) {
					state.done = true;
					return;
				}
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		},
		{ selector: TITLE_SELECTOR, windowMs: SAMPLE_WINDOW_MS } satisfies SamplerArgs
	);
}

async function readTitleLog(page: Page): Promise<TitleFrame[]> {
	return page.evaluate(() => {
		const s = (window as unknown as TitleSamplerWindow).__titleLog;
		return s ? s.frames : [];
	});
}

/** The settled deep-title text (exactly one span at rest on a deep page). */
async function readDeepTitle(page: Page): Promise<string> {
	const text = await page.locator(TITLE_SELECTOR).first().innerText();
	return text.trim();
}

// --- gesture: real CDP touch back-swipe dragged to ~half width --------------
// detectSwipe (src/lib/actions/swipe.ts) rejects pointerType 'mouse', so this
// flows through CDP Input.dispatchTouchEvent like the shared swipeBack helper.
// EndX = startX + 0.5 * viewport → morph ≈ 0.5 (the reported "halfway"), which
// is well past SWIPE_COMMIT (60) so the gesture commits and the navigation
// lands - the precondition for the replay. Inter-move yields (≈16ms) stretch
// the drag over ~200ms so the rAF sampler reliably catches the in-drag
// two-title state.
async function swipeBackBy(page: Page, fraction: number): Promise<void> {
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	const y = 400;
	const startX = Math.round(width * 0.3);
	const endX = startX + Math.round(width * fraction);
	const steps = 14;
	const dispatch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		x: number,
		state: string
	): Promise<unknown> =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});

	await dispatch('touchStart', startX, 'touchPressed');
	for (let i = 1; i <= steps; i++) {
		const x = Math.round(startX + (endX - startX) * (i / steps));
		await dispatch('touchMove', x, 'touchMoved');
		await page.waitForTimeout(16);
	}
	await dispatch('touchEnd', endX, 'touchReleased');
	await client.detach();
}

/** Commit back-swipe: endX = startX + 0.5*width, past SWIPE_COMMIT (60). */
async function swipeBackHalf(page: Page): Promise<void> {
	return swipeBackBy(page, 0.5);
}

/** Cancel back-swipe: endX = startX + ~0.11*width (< 60px), below SWIPE_COMMIT. */
async function swipeBackShort(page: Page): Promise<void> {
	return swipeBackBy(page, 0.11);
}

// --- analysis --------------------------------------------------------------

interface PresenceSummary {
	/** Reduced (path, has-incoming) sequence in first-seen order, for diagnostics. */
	seq: string[];
	/** Count of incoming-title present -> absent -> present cycles (the bug). */
	cycles: number;
	/** Max concurrent title spans seen in any single frame. */
	maxConcurrent: number;
	/** A frame on the SOURCE page (/profile/edit) with a single title centred -
	 * the post-release STATIC collapse. null if never observed. */
	collapseSeen: boolean;
	/** A frame on the DESTINATION page (/profile/settings) with >=2 titles -
	 * the replay. null if never observed. */
	replaySeen: boolean;
}

function summarizeIncoming(log: TitleFrame[], incomingText: string): PresenceSummary {
	const seq: string[] = [];
	let lastHas: boolean | null = null;
	let maxConcurrent = 0;
	let collapseSeen = false;
	let replaySeen = false;
	for (const f of log) {
		if (f.spans.length > maxConcurrent) maxConcurrent = f.spans.length;
		const has = f.spans.some((s) => s.text === incomingText);
		// Collapse: single span (STATIC) on the source page after the drag began.
		if (f.path === '/profile/edit' && f.spans.length === 1) collapseSeen = true;
		// Replay: two titles on the destination page (the re-triggered crossfade).
		if (f.path === '/profile/settings' && f.spans.length >= 2) replaySeen = true;
		if (lastHas !== has) {
			seq.push(`${has ? 'ON ' : 'OFF'}@${f.path}`);
			lastHas = has;
		}
	}
	// Count present -> absent -> present cycles in the reduced sequence.
	const pres: boolean[] = seq.map((s) => s.startsWith('ON'));
	let cycles = 0;
	for (let i = 1; i < pres.length - 1; i++) {
		if (pres[i - 1] && !pres[i] && pres[i + 1]) cycles++;
	}
	return { seq, cycles, maxConcurrent, collapseSeen, replaySeen };
}

// --- shared setup: / -> /profile/settings -> /profile/edit -----------------

interface SetupTitles {
	settingsTitle: string;
	editTitle: string;
}

async function setupEditFromSettings(page: Page): Promise<SetupTitles> {
	await page.goto('/');
	await waitForHydration(page);
	await openSidebarAndGoto(page, '/profile/settings');
	await page.waitForTimeout(300);
	const settingsTitle = await readDeepTitle(page);

	await page.locator('a[href="/profile/edit"]').first().click();
	await page.waitForURL('/profile/edit');
	// Let the forward title crossfade + its 250ms safety timeout settle so the
	// subsequent back-swipe starts from the steady STATIC state (titleTransition
	// Active === false) - the realistic precondition for the reported bug.
	await page.waitForTimeout(400);
	const editTitle = await readDeepTitle(page);
	return { settingsTitle, editTitle };
}

test.beforeEach(async ({ context }) => {
	await prepareContext(context);
});

// CALIBRATION: prove the harness reaches /profile/edit, the half-swipe commits
// to /profile/settings, and the sampler caught the in-drag two-title state. If
// this fails the regression assertion below is meaningless (the swipe did not
// register as a drag, or never committed).
test('CALIBRATION: half back-swipe /profile/edit -> /profile/settings commits with the incoming title live', async ({
	page
}) => {
	const { settingsTitle, editTitle } = await setupEditFromSettings(page);
	expect(editTitle, 'edit and settings titles must differ for a crossfade to exist').not.toBe(
		settingsTitle
	);

	await installTitleSampler(page);
	await swipeBackHalf(page);
	await page.waitForURL('/profile/settings', { timeout: 5000 });
	await page.waitForTimeout(500);

	const log = await readTitleLog(page);
	expect(log.length, 'sampler must have captured frames').toBeGreaterThan(20);

	// The drag must have registered: at least one frame on /profile/edit showed
	// BOTH titles (outgoing edit + incoming settings) - i.e. the DRAG branch ran.
	const dragFrame = log.find(
		(f) => f.path === '/profile/edit' && f.spans.some((s) => s.text === settingsTitle)
	);
	expect(
		dragFrame,
		`incoming title "${settingsTitle}" never appeared during the drag on /profile/edit - the swipe did not engage the DRAG branch`
	).toBeTruthy();

	// And the gesture committed onto the destination.
	expect(new URL(page.url()).pathname).toBe('/profile/settings');
});

// REGRESSION: the incoming title must NOT vanish at release and re-animate on
// landing. Pre-fix the presence sequence is ON(drag) -> OFF(collapse) ->
// ON(replay) = 1 cycle. Post-fix the incoming title stays visible through the
// handoff (the drag branch hands morph straight to the settled title) = 0.
test('REGRESSION: back-swipe commit must not collapse-then-replay the deep title', async ({
	page
}) => {
	const { settingsTitle } = await setupEditFromSettings(page);

	await installTitleSampler(page);
	await swipeBackHalf(page);
	await page.waitForURL('/profile/settings', { timeout: 5000 });
	// Capture through the release collapse (~200ms track transition) and the
	// post-landing replay (~200ms crossfade).
	await page.waitForTimeout(800);

	const log = await readTitleLog(page);
	const summary = summarizeIncoming(log, settingsTitle);

	expect(
		log.some((f) => f.path === '/profile/edit' && f.spans.length >= 2),
		'precondition: the in-drag two-title state was captured'
	).toBe(true);

	expect(
		summary.cycles,
		`incoming title "${settingsTitle}" vanished then re-appeared (collapse + replay). ` +
			`presence sequence: [${summary.seq.join(', ')}]; ` +
			`collapseOnSource=${summary.collapseSeen}, replayOnDest=${summary.replaySeen}, ` +
			`maxConcurrent=${summary.maxConcurrent}`
	).toBe(0);
});

// CANCEL: a sub-threshold back-swipe releases without committing. The incoming
// title must retreat smoothly (not vanish mid-retreat) and must not re-appear
// (no replay, since no navigation lands). The page stays on /profile/edit.
test('CANCEL: sub-threshold back-swipe retreats the incoming title with no replay', async ({
	page
}) => {
	const { settingsTitle, editTitle } = await setupEditFromSettings(page);

	await installTitleSampler(page);
	await swipeBackShort(page);
	// A cancelled gesture does not navigate; hold long enough to capture the
	// retreat animation (~200ms) and confirm no late navigation.
	await page.waitForTimeout(600);

	expect(new URL(page.url()).pathname).toBe('/profile/edit');

	const log = await readTitleLog(page);
	const summary = summarizeIncoming(log, settingsTitle);
	expect(
		summary.cycles,
		`incoming title "${settingsTitle}" re-appeared after retreating (unexpected replay on cancel). ` +
			`presence sequence: [${summary.seq.join(', ')}]`
	).toBe(0);
	// The drag must have engaged (incoming visible at some point) for the retreat
	// to be meaningful, and the header must end showing the source title.
	expect(
		log.some((f) => f.path === '/profile/edit' && f.spans.some((s) => s.text === settingsTitle)),
		'precondition: the incoming title appeared during the cancelled drag'
	).toBe(true);
	expect(editTitle, 'sanity: edit title read').toBeTruthy();
});
