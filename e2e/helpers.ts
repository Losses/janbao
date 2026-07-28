import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import type { Page, Cookie, BrowserContext } from '@playwright/test';

/**
 * E2E helpers for the mobile back-swipe matrix. Run under the Playwright (node)
 * runner against the vite dev server; the app itself stays Bun.
 */

export type Entry = 'hard' | 'reload' | 'tab' | 'sidebar';
export type Source = 'discussion' | 'activity' | 'messages';

export const TAB_HREF: Record<Source, string> = {
	discussion: '/',
	activity: '/activity',
	messages: '/messages/inbox'
};

// --- Auth: mint an admin (id 0) session cookie, throttle-immune. -------------

function readJwtSecret(): string {
	// The Playwright runner is node, which does NOT auto-load .env (Bun does for
	// the dev server). Read the same secret the dev server signs with so the
	// cookie verifies in hooks.server.ts.
	if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
	try {
		const env = readFileSync('.env', 'utf8');
		const match = env.match(/^JWT_SECRET\s*=\s*(.+)$/m);
		if (match) return match[1].trim().replace(/^"|"$/g, '');
	} catch {
		/* fall through to dev default */
	}
	return 'fallback-secret-key-for-local-dev-only';
}

function b64url(buf: Buffer): string {
	return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Reproduces src/lib/server/auth.ts signJwt + createSessionToken for the admin
 * account (id 0). HS256 over `base64url(header).base64url(payload)`.
 */
export function mintAdminCookie(): Cookie {
	const secret = readJwtSecret();
	const now = Math.floor(Date.now() / 1000);
	const payload = { sub: '0', username: 'admin', role: 'admin', iat: now, exp: now + 2592000 };
	const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
	const body = b64url(Buffer.from(JSON.stringify(payload)));
	const message = `${header}.${body}`;
	const signature = b64url(createHmac('sha256', secret).update(message).digest());
	return {
		name: 'session_token',
		value: `${message}.${signature}`,
		domain: 'localhost',
		path: '/',
		expires: now + 2592000,
		httpOnly: true,
		secure: false,
		sameSite: 'Strict'
	};
}

// --- Gesture: real touch swipe via CDP. --------------------------------------
// detectSwipe (src/lib/actions/swipe.ts) rejects pointerType 'mouse', so
// page.mouse.* is useless. CDP Input.dispatchTouchEvent flows through the real
// input pipeline and synthesises pointerType:'touch' PointerEvents that
// detectSwipe recognises natively.

export interface SwipeResult {
	activated: boolean;
}

/**
 * Drive a purely-horizontal touch swipe from `startX` to `endX` via CDP (the
 * only path detectSwipe recognises - it rejects pointerType 'mouse'). The start
 * point must stay inside the (40, width-40) edge dead-zone; dx is well past
 * SWIPE_COMMIT(60) and purely horizontal so |dx| > |dy|*1.6.
 */
async function swipeHorizontal(page: Page, startX: number, endX: number): Promise<SwipeResult> {
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const y = 400;
	const steps = 14;

	const dispatch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, state: string) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			// CDP needs each touch point's state (touchPressed/Moved/Released);
			// playwright's TouchPoint type omits it, so cast past the mismatch.
			touchPoints: [{ state, x, y, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});

	await dispatch('touchStart', startX, 'touchPressed');
	for (let i = 1; i <= steps; i++) {
		const x = Math.round(startX + (endX - startX) * (i / steps));
		await dispatch('touchMove', x, 'touchMoved');
	}
	await dispatch('touchEnd', endX, 'touchReleased');
	await client.detach();
	return { activated: true };
}

/** Rightward swipe (dx>0) → previous tab. */
export async function swipeBack(page: Page): Promise<SwipeResult> {
	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.3);
	return swipeHorizontal(page, startX, startX + 260);
}

/** Leftward swipe (dx<0) → next tab. Mirror of swipeBack. */
export async function swipeForward(page: Page): Promise<SwipeResult> {
	const width = page.viewportSize()?.width ?? 393;
	const startX = Math.round(width * 0.7);
	return swipeHorizontal(page, startX, startX - 260);
}

/** Stamp the test context: admin cookie + neuter any zombie service worker. */
export async function prepareContext(context: BrowserContext): Promise<void> {
	await context.addCookies([mintAdminCookie()]);
	// Dev doesn't register a SW (prod-only), but a zombie SW from a prior prod
	// build can intercept the first fetches and serve a stale/offline response,
	// flipping the app to its "You're offline" state. Neuter registration and
	// unregister existing SWs BEFORE any app script runs on each navigation.
	await context.addInitScript(() => {
		if (!('serviceWorker' in navigator)) return;
		try {
			const proto = Object.getPrototypeOf(navigator.serviceWorker);
			Object.defineProperty(proto, 'register', {
				value: () => Promise.resolve({ unregister: () => Promise.resolve(), scope: '/' }),
				configurable: true
			});
		} catch {
			/* ignore */
		}
		navigator.serviceWorker
			.getRegistrations()
			.then((rs) => rs.forEach((r) => r.unregister()))
			.catch(() => {});
	});
}

// --- Navigation helpers. ------------------------------------------------------

/**
 * Client-side navigate to a global route deterministically. A real user reaches
 * /bookmarks etc. via the drawer, whose open transition races in tests.
 * `__e2eGoto` (a dev-only hook wrapping SvelteKit's goto) fires the EXACT same
 * beforeNavigate the drawer link ultimately does - so the backTarget
 * precondition under test is identical, without the timing surface.
 */
export async function openSidebarAndGoto(page: Page, href: string): Promise<void> {
	await page.evaluate((target) => (window as { __e2eGoto?: (h: string) => Promise<void> }).__e2eGoto!(target), href);
	await page.waitForFunction((t) => location.pathname === t, href, { timeout: 5000 });
	await page.waitForTimeout(200);
}

/**
 * Wait for SvelteKit hydration before clicking. A click before hydration is a
 * full browser navigation (not SPA), which runs init() instead of switchTab /
 * handleBeforeNavigate - silently changing the backTarget precondition under
 * test. The dev-only __navStore hook is set during root-layout client init, so
 * its presence marks a hydrated, SPA-ready page.
 */
export async function waitForHydration(page: Page): Promise<void> {
	// Wait until the root layout's one-time init() has run. It executes in
	// onMount (after the client is interactive), so clicking before this races
	// the deferred init('/') that would clobber activeTab and make the
	// backTarget flaky. __navReady is set at the end of that onMount init.
	await page.waitForFunction(() => (window as { __navReady?: boolean }).__navReady === true, {
		timeout: 10_000
	});
}

/** Land on a source tab via the given entry method (sets up the backTarget precondition). */
export async function enterSource(page: Page, entry: Entry, source: Source): Promise<void> {
	const src = TAB_HREF[source];
	if (entry === 'hard') {
		await page.goto(src);
		await waitForHydration(page);
	} else if (entry === 'reload') {
		await page.goto(src);
		await waitForHydration(page);
		await page.reload();
		await waitForHydration(page);
	} else {
		// In-app entry (tab tap / sidebar link). Both ultimately do a client-side
		// nav that handleBeforeNavigate maps to the source's tab, setting activeTab
		// correctly - the same as the real data-tab-nav switchTab path (whose
		// logic is covered by the bun unit test). Driven deterministically via the
		// goto hook so the SPA-vs-full-load timing of a raw link click does not
		// make the control flake.
		await page.goto('/');
		await waitForHydration(page);
		await openSidebarAndGoto(page, src);
	}
	await page.waitForLoadState('domcontentloaded');
	await page.waitForTimeout(200);
}

/** Wait for the SPA URL to leave `from` (covers pushState/replaceState/history.back). */
export async function waitForUrlNot(page: Page, from: string, timeout = 5000): Promise<string> {
	await page.waitForFunction((f) => location.pathname !== f, from, { timeout });
	return new URL(page.url()).pathname;
}

/** Collect console text so a test can prove detectSwipe actually fired. */
export function collectConsole(page: Page): string[] {
	const messages: string[] = [];
	page.on('console', (m) => messages.push(m.text()));
	return messages;
}

// --- Thread enter-animation capture ----------------------------------------
// NavPipelineHost plays a list→thread slide-in when the discussion is reached
// from the resolved left href (the `shouldEnter` $derived.by gate: forward
// direction AND the stack's previous pathname === resolvedLeftHref): the track
// is seeded at translateX(0px) and slides to its resting translateX(-33.333%)
// over ~200ms. We sample the track's computed translateX to prove the animation
// ran - the only behavioural signal that the transition animated. The regression
// test for the tab-tap-return bug relies on this: a stale thread entry in the
// nav stack breaks the shouldEnter precondition and suppresses the slide-in
// (the track is born already at rest and never moves).

interface EnterAnimState {
	samples: number[];
	firstInline: string | null;
	done: boolean;
}

interface EnterAnimWindow extends Window {
	__anim?: EnterAnimState;
}

export interface EnterAnimCapture {
	animated: boolean;
	delta: number;
	firstInline: string | null;
	sampleCount: number;
}

/**
 * Install a rAF sampler, trigger a navigation, then report whether the
 * NavPipelineHost track translated (i.e. the slide-in played). The sampler
 * polls for `.detail-scroll-pane` (the thread's centre panel, present only on a
 * thread page) and records its parent track's translateX each frame for 700ms.
 * `animated` is true iff the track moved >100px - unambiguous, since the only
 * track animation on a thread page is the enter slide (≈ one viewport wide).
 */
export async function captureEnterAnimation(
	page: Page,
	trigger: () => Promise<void>
): Promise<EnterAnimCapture> {
	await page.evaluate(() => {
		const w = window as unknown as EnterAnimWindow;
		const state: EnterAnimState = { samples: [], firstInline: null, done: false };
		w.__anim = state;
		let startT: number | null = null;
		let track: HTMLElement | null = null;
		const findTrack = (): HTMLElement | null => {
			const centre = document.querySelector('.detail-scroll-pane');
			return centre ? (centre.parentElement as HTMLElement) : null;
		};
		const tick = (): void => {
			if (track === null) {
				track = findTrack();
				if (track !== null) {
					state.firstInline = track.style.transform;
					startT = performance.now();
				}
			}
			if (track !== null && startT !== null) {
				const elapsed = performance.now() - startT;
				let tx = 0;
				try {
					tx = new DOMMatrix(getComputedStyle(track).transform).m41;
				} catch {
					tx = 0;
				}
				state.samples.push(Math.round(tx));
				if (elapsed > 700) {
					state.done = true;
					return;
				}
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	await trigger();
	await page.waitForFunction(
		() => (window as unknown as EnterAnimWindow).__anim?.done === true,
		{ timeout: 8000 }
	);
	return await page.evaluate(() => {
		const a = (window as unknown as EnterAnimWindow).__anim!;
		const samples = a.samples;
		const delta = samples.length > 0 ? Math.max(...samples) - Math.min(...samples) : 0;
		return {
			animated: delta > 100,
			delta,
			firstInline: a.firstInline,
			sampleCount: samples.length
		};
	});
}

/** Click the Nth discussion link in the discussions list (0-indexed). */
export async function clickDiscussion(page: Page, index: number): Promise<void> {
	await page.locator('a[href^="/discussion/"]').nth(index).click();
}

// --- Thread header hide-on-scroll capture ----------------------------------
// On a mobile thread page the document window is locked by `html.fixed-viewport`
// (html/body are position:fixed; overflow:hidden), so the thread scrolls INSIDE
// `.detail-scroll-pane` (overflow-y:auto; height:100%), not the window. The
// shared scroll-chrome store must therefore react to the CONTAINER's scroll for
// the hide-on-down / reveal-on-up Header animation. Pre-fix it only listened to
// `window` and the Header never moved.

export interface HeaderScrollCapture {
	vh: number;
	/** Header translateY after scrolling down (must be << 0: hidden) and back up
	 * (must be 0: revealed). */
	downTranslateY: number | null;
	upTranslateY: number | null;
	/** Viewport-Y of the first heading inside the scroll pane at the top of the
	 * page. Guards against the "top eaten" regression: the overlay Header must
	 * not cover the first content element. */
	topFirstContentTop: number;
	/** Whether the element painted at the viewport's TOP edge is inside the
	 * content card after scrolling down - i.e. the card fills the space the
	 * Header vacated (no header-tall blank gap). */
	downTopIsCard: boolean;
	/** Bottom edge of the content card (`.gpl-card`) when scrolled to the
	 * bottom. It must end ABOVE the viewport bottom so the page-bg strip shows
	 * below it (matching the homepage). */
	bottomCardBottom: number;
	/** Whether the element painted at the viewport's BOTTOM edge (at scroll-end)
	 * is OUTSIDE the content card - i.e. the page-bg strip is showing, not the
	 * card. */
	bottomIsPageBg: boolean;
	/** Computed background of the content card (must be base-100 / white) and the
	 * scroll pane (must be base-200 / page bg) - the homepage's card-on-page-bg. */
	cardBg: string;
	paneBg: string;
}

/**
 * Drive the thread's centre panel: top → down (hide Header) → bottom → back to
 * top (reveal Header). Reports the Header translateY at each phase plus the
 * card/pane geometry that locks in the homepage-consistent look: content not
 * eaten at the top, no gap when the Header hides, and a page-bg strip (not card
 * bg) at the bottom.
 */
export async function captureHeaderOnThreadScroll(page: Page): Promise<HeaderScrollCapture> {
	return page.evaluate(async () => {
		const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
		// Wait for a layout frame AND for the Header's hide/show translateY to
		// reach its settled value before reading geometry: the hide/show is a
		// reactive read of the scroll-chrome store (its own rAF-throttled
		// scroll listener publishes each frame; no CSS transition on the
		// Header). The assertions check the SETTLED state, not mid-animation.
		const afterFrame = (): Promise<void> =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			).then(() => sleep(240));
		const readTy = (): number | null => {
			const h = document.querySelector('header');
			if (!h) return null;
			const m = h.style.transform.match(/translateY\(([-0-9.]+)px\)/);
			return m ? Number(m[1]) : 0;
		};
		const pane = document.querySelector('.detail-scroll-pane') as HTMLElement | null;
		if (!pane) throw new Error('detail-scroll-pane not found');
		const card = pane.querySelector('.gpl-card') as HTMLElement | null;
		const inCard = (x: number, y: number): boolean => {
			const el = document.elementFromPoint(x, y) as HTMLElement | null;
			return !!el && !!el.closest('.gpl-card');
		};

		pane.scrollTop = 0;
		await afterFrame();
		const firstEl = pane.querySelector('h1, h2, img, a, [id]') as HTMLElement | null;
		const topFirstContentTop = firstEl ? Math.round(firstEl.getBoundingClientRect().top) : -1;

		const downTarget = Math.max(800, pane.scrollHeight - pane.clientHeight - 200);
		pane.scrollTop = downTarget;
		await afterFrame();
		const downTranslateY = readTy();
		const downTopIsCard = inCard(50, 4);

		pane.scrollTop = pane.scrollHeight;
		await afterFrame();
		const bottomCardBottom = card ? Math.round(card.getBoundingClientRect().bottom) : -1;
		const bottomIsPageBg = !inCard(50, window.innerHeight - 4);

		pane.scrollTop = 0;
		await afterFrame();
		const upTranslateY = readTy();

		return {
			vh: window.innerHeight,
			downTranslateY,
			upTranslateY,
			topFirstContentTop,
			downTopIsCard,
			bottomCardBottom,
			bottomIsPageBg,
			cardBg: card ? getComputedStyle(card).backgroundColor : '',
			paneBg: getComputedStyle(pane).backgroundColor
		};
	});
}

// --- Cross-tab exit preview capture ----------------------------------------
// Tapping a tab from a NavPipelineHost deep page (thread / messages
// conversation) cancels the SvelteKit nav in beforeNavigate, slides the track
// to reveal a neighbouring panel as the exit "preview", then navigates on
// the orchestrator's commit-settle. The detail page FIXES which lists those panels hold:
//   discussion -> left=DiscussionsPanel, right=ActivityPanel
//   messages   -> left=MessagesPanel only (no right)
// So tapping a tab that is NOT one of the pre-rendered panels reveals the
// WRONG list during the slide (e.g. message->/ previews the messages inbox,
// not the homepage). This sampler records which tab list actually covered the
// viewport during the slide, so a test can prove preview == target.

export type PreviewTab = 'discussions' | 'activity' | 'messages' | null;

export interface ExitPreviewCapture {
	animated: boolean;
	delta: number;
	sampleCount: number;
	/** Distinct `data-tab-panel` values of non-centre panels that covered >40%
	 * of the viewport during the slide, in first-seen order. A correct exit
	 * contains only the target tab; a wrong tab list or a non-tab panel (null)
	 * is a failure. */
	seenTabs: PreviewTab[];
	/** The non-detail panel with the highest single-frame viewport coverage -
	 * i.e. the panel the slide actually revealed as the preview. */
	revealedTab: PreviewTab;
}

interface ExitPreviewSamplerState {
	tx: number[];
	seen: PreviewTab[];
	maxCovCls: PreviewTab;
	maxCov: number;
	done: boolean;
}

interface ExitPreviewWindow extends Window {
	__exitPreview?: ExitPreviewSamplerState;
}

/**
 * Install a rAF sampler over the NavPipelineHost track, trigger a tab-tap
 * navigation, then report which tab list the slide revealed. The sampler polls
 * `.detail-scroll-pane` (the thread/conversation centre panel); its parent track
 * holds the left/right preview `<section>`s side-by-side with the centre. Each
 * frame it measures every non-centre section's horizontal intersection with the
 * viewport and records the `data-tab-panel` attribute of any covering >40% of
 * the width. The attribute is set by NavPipelineHost to the rendered panel's
 * tab labelKey (or null when the panel is not a tab list), so detection does not
 * depend on DOM content - content markers collide across pages and cannot
 * enumerate non-tab sidebars.
 */
export async function captureExitPreview(
	page: Page,
	trigger: () => Promise<void>
): Promise<ExitPreviewCapture> {
	await page.evaluate(() => {
		const w = window as unknown as ExitPreviewWindow;
		const state: ExitPreviewSamplerState = {
			tx: [],
			seen: [],
			maxCovCls: null,
			maxCov: 0,
			done: false
		};
		w.__exitPreview = state;
		let startT: number | null = null;
		const tick = (): void => {
			const centre = document.querySelector('.detail-scroll-pane');
			if (!centre) {
				state.done = true;
				return;
			}
			const track = centre.parentElement;
			if (!track) {
				requestAnimationFrame(tick);
				return;
			}
			if (startT === null) startT = performance.now();
			let tx = 0;
			try {
				tx = new DOMMatrix(getComputedStyle(track).transform).m41;
			} catch {
				tx = 0;
			}
			state.tx.push(Math.round(tx));
			const vw = window.innerWidth;
			const sections = Array.from(track.children).filter(
				(c) => c.tagName === 'SECTION'
			) as HTMLElement[];
			for (const s of sections) {
				if (s.classList.contains('detail-scroll-pane')) continue;
				const rect = s.getBoundingClientRect();
				const inter = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
				const cov = vw > 0 ? inter / vw : 0;
				if (cov <= 0.4) continue;
				// Identity: `data-tab-panel` (NavPipelineTabHost + NavPipelineHost
				// preview sections).
				const key = s.getAttribute('data-tab-panel') as PreviewTab;
				if (!state.seen.includes(key)) state.seen.push(key);
				if (cov > state.maxCov) {
					state.maxCov = cov;
					state.maxCovCls = key;
				}
			}
			if (performance.now() - startT > 900) {
				state.done = true;
				return;
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});

	await trigger();

	try {
		await page.waitForFunction(
			() => (window as unknown as ExitPreviewWindow).__exitPreview?.done === true,
			{ timeout: 2000 }
		);
	} catch {
		/* The detail layout unmounts when the deferred nav lands; that's the
		 * normal end of the animation. */
	}

	return await page.evaluate(() => {
		const s = (window as unknown as ExitPreviewWindow).__exitPreview!;
		const tx = s.tx;
		const delta = tx.length > 0 ? Math.max(...tx) - Math.min(...tx) : 0;
		return {
			animated: delta > 50,
			delta,
			sampleCount: tx.length,
			seenTabs: s.seen,
			revealedTab: s.maxCovCls
		};
	});
}

// --- FAB route-transition capture -------------------------------------------
// Samples `[data-testid="fab"]`'s computed scale each frame for ~700ms across
// `trigger`. The FAB atom binds `transform: scale(s) translateY(y)`; the scale
// is driven by the global nav-pipeline orchestrator's per-frame publication of
// `publication.progress`, which the FAB layer reads directly and maps through
// `computeFabScale(inputs)` (the 5-branch derivation: boundary void-swipe,
// suppressed tab, settle-owned enterAnchor lerp, dragAnchor shift, default
// natural `fabScale(progress, fromHasFab, toHasFab)`). A discrete swap that
// eases the scale therefore shows many distinct descending frames (a new
// `publication.progress` each frame); a snap shows a one-frame jump.
// `animated` (scale delta > 0.1) is the behavioural signal. The FAB atom
// carries no CSS transition directive and no transitionend the test can await.

interface FabFrame {
	t: number;
	scale: number;
}
interface FabSamplerWindow extends Window {
	__fabFrames?: { frames: FabFrame[]; done: boolean };
}

export interface FabTransitionCapture {
	animated: boolean;
	delta: number;
	firstScale: number | null;
	lastScale: number | null;
	sampleCount: number;
}

export async function captureFabTransition(
	page: Page,
	trigger: () => Promise<void>
): Promise<FabTransitionCapture> {
	await page.evaluate(() => {
		const w = window as unknown as FabSamplerWindow;
		const state = { frames: [] as FabFrame[], done: false };
		w.__fabFrames = state;
		const start = performance.now();
		const tick = (): void => {
			const el = document.querySelector('[data-testid="fab"]') as HTMLElement | null;
			if (el) {
				const m = getComputedStyle(el).transform.match(/matrix\(([^)]+)\)/);
				const scale = m ? Number(m[1].split(',')[0]) : 1;
				state.frames.push({
					t: Math.round(performance.now() - start),
					scale
				});
			}
			if (performance.now() - start > 700) {
				state.done = true;
				return;
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	await trigger();
	await page.waitForFunction(
		() => (window as unknown as FabSamplerWindow).__fabFrames?.done === true,
		{ timeout: 5000 }
	);
	return page.evaluate(() => {
		const f = (window as unknown as FabSamplerWindow).__fabFrames!.frames;
		const scales = f.map((x) => x.scale).filter(Number.isFinite);
		const delta = scales.length ? Math.max(...scales) - Math.min(...scales) : 0;
		return {
			animated: delta > 0.1,
			delta,
			firstScale: scales[0] ?? null,
			lastScale: scales[scales.length - 1] ?? null,
			sampleCount: f.length
		};
	});
}

// --- tab-host switch capture ------------------------------------------------
// Samples the pager track's m41 (px) plus the `data-tab-panel` of the section
// covering the viewport centre, each frame across `trigger`. A clean tab switch
// slides the track through intermediate m41 values and the centered-panel
// sequence runs source -> neighbours -> target; a snap jumps m41 in one frame
// and the centered panel flips source -> target with nothing between.

interface PagerFrame {
	t: number;
	m41: number;
	center: string | null;
}
interface PagerSamplerWindow extends Window {
	__pagerFrames?: { frames: PagerFrame[]; done: boolean };
}

export interface PagerSwitchCapture {
	animated: boolean;
	delta: number;
	seenPanels: (string | null)[];
	firstPanel: string | null;
	lastPanel: string | null;
	sampleCount: number;
}

export async function capturePagerSwitch(
	page: Page,
	trigger: () => Promise<void>
): Promise<PagerSwitchCapture> {
	await page.evaluate(() => {
		const w = window as unknown as PagerSamplerWindow;
		const state = { frames: [] as PagerFrame[], done: false };
		w.__pagerFrames = state;
		const start = performance.now();
		const centerPanel = (): string | null => {
			const vw = window.innerWidth;
			let best: string | null = null;
			let bestCov = 0;
			for (const s of Array.from(
				document.querySelectorAll('[data-testid="nav-pipeline-tab-track"] section')
			)) {
				const r = (s as HTMLElement).getBoundingClientRect();
				const cov = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
				if (cov > bestCov) {
					bestCov = cov;
					best = s.getAttribute('data-tab-panel');
				}
			}
			return best;
		};
		const tick = (): void => {
			const track = document.querySelector('[data-testid="nav-pipeline-tab-track"]') as
				| HTMLElement
				| null;
			if (track) {
				let m41 = 0;
				try {
					m41 = new DOMMatrix(getComputedStyle(track).transform).m41;
				} catch {
					m41 = 0;
				}
				state.frames.push({
					t: Math.round(performance.now() - start),
					m41: Math.round(m41),
					center: centerPanel()
				});
			}
			if (performance.now() - start > 700) {
				state.done = true;
				return;
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	await trigger();
	await page.waitForFunction(
		() => (window as unknown as PagerSamplerWindow).__pagerFrames?.done === true,
		{ timeout: 5000 }
	);
	return page.evaluate(() => {
		const f = (window as unknown as PagerSamplerWindow).__pagerFrames!.frames;
		const m41s = f.map((x) => x.m41);
		const delta = m41s.length ? Math.max(...m41s) - Math.min(...m41s) : 0;
		const seen: (string | null)[] = [];
		for (const p of f.map((x) => x.center)) {
			if (seen.length === 0 || seen[seen.length - 1] !== p) seen.push(p);
		}
		return {
			animated: delta > 50,
			delta,
			seenPanels: seen,
			firstPanel: f[0]?.center ?? null,
			lastPanel: f[f.length - 1]?.center ?? null,
			sampleCount: f.length
		};
	});
}

// --- NavPipelineHost track-presence capture ------------------------------
// Polls `.detail-scroll-pane` (the centre panel, present only when a
// NavPipelineHost is mounted) each frame for ~700ms across `trigger`. Every
// mobile route that mounts NavPipelineHost (the thread / deep routes AND the
// three compose routes /post/discussion, /messages/new, /messages/add/[userId],
// which mount NavPipelineHost via MessageCompose / directly) owns a track the
// enter animation (`shouldEnter`) slides. The capture's track-presence signal
// distinguishes a route that mounts the host from one that does not; use
// captureEnterAnimation for the slide magnitude on a thread / deep route.

interface GplTrackFrame {
	t: number;
	hasTrack: boolean;
}
interface GplTrackWindow extends Window {
	__gplTrack?: { frames: GplTrackFrame[]; done: boolean };
}

export interface GplTrackPresenceCapture {
	sampleCount: number;
	trackFrames: number;
	trackEverMounted: boolean;
}

export async function captureGplTrackPresence(
	page: Page,
	trigger: () => Promise<void>
): Promise<GplTrackPresenceCapture> {
	await page.evaluate(() => {
		const w = window as unknown as GplTrackWindow;
		w.__gplTrack = { frames: [], done: false };
		const start = performance.now();
		const tick = (): void => {
			w.__gplTrack!.frames.push({
				t: Math.round(performance.now() - start),
				hasTrack: !!document.querySelector('.detail-scroll-pane')
			});
			if (performance.now() - start > 700) {
				w.__gplTrack!.done = true;
				return;
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	await trigger();
	await page.waitForFunction(
		() => (window as unknown as GplTrackWindow).__gplTrack?.done === true,
		{ timeout: 5000 }
	);
	return page.evaluate(() => {
		const f = (window as unknown as GplTrackWindow).__gplTrack!.frames;
		const trackFrames = f.filter((x) => x.hasTrack).length;
		return {
			sampleCount: f.length,
			trackFrames,
			trackEverMounted: trackFrames > 0
		};
	});
}

// --- GPL back-swipe capture -------------------------------------------------
// Drives a partial (held) rightward back-swipe via CDP touch from `startX` to
// `endX`, holds one frame, snapshots the back-preview state the
// NavPipelineHost publishes, then releases. The snapshot records the left
// panel's `data-tab-panel` (the seeded back-preview, or null when no preview
// rendered) and the track's translateX (`trackM41`) for geometry checks.
// `chipMode` and `chipText` are kept as a regression guard for spec End state
// #4 (the cross-tab chip overlay is absent everywhere): they query for a
// `.loading-overlay` element and its label text, and are always false / null
// on a passing run.

export interface GplChipSwipeCapture {
	chipMode: boolean;
	previewPanel: string | null;
	chipText: string | null;
	trackM41: number | null;
}

export async function captureGplBackSwipe(
	page: Page,
	startX = 120,
	endX = 240
): Promise<GplChipSwipeCapture> {
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', {
		enabled: true,
		maxTouchPoints: 5
	});
	const y = 400;
	const disp = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, state: string) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});
	await disp('touchStart', startX, 'touchPressed');
	for (let x = startX + 15; x <= endX; x += 15) await disp('touchMove', x, 'touchMoved');
	await page.waitForTimeout(250);
	const snap = await page.evaluate(() => {
		const centre = document.querySelector('.detail-scroll-pane');
		const track = centre?.parentElement as HTMLElement | null;
		const overlay = document.querySelector('.loading-overlay') as HTMLElement | null;
		const leftSection = centre?.parentElement?.querySelector(
			'section:not(.detail-scroll-pane)'
		) as HTMLElement | null;
		return {
			chipMode: !!overlay,
			previewPanel: leftSection?.getAttribute('data-tab-panel') ?? null,
			chipText: overlay?.querySelector('span')?.textContent ?? null,
			trackM41: track ? Math.round(new DOMMatrix(getComputedStyle(track).transform).m41) : null
		};
	});
	await disp('touchEnd', endX, 'touchReleased');
	await client.detach();
	return snap;
}

// --- Multi-signal header/track sampler (DV20 drag-sync + jank tests) --------
// Records a bundle of header + track signals each rAF frame so a test can
// prove they move IN SYNC with the finger during a held drag (the DV20 §5
// invariant: every visual is a pure function of the one published progress,
// written synchronously per pointermove), and measure frame intervals to
// detect jank. One sampler covers the header morph (root layer / title layer
// translateY), the BurgerArrowIcon rotation, the root<->search header track,
// the NavPipelineHost (deep) + NavPipelineTabHost (tab) tracks, the FAB scale,
// the primary pager store's live values, and the active tab pill.
//
// Signals and their meaning:
//   hdrTrackTx    header root<->search track translateX (px). ~0 at a tab
//                 root, ~-viewport/2 when the search panel covers the bar.
//   rootLayerTy   header root layer (MobileTabBar wrapper) translateY (px).
//                 0 = visible (tab bar shown), -headerHeight = hidden (deep).
//   deepLayerTy   header title layer translateY (px). 0 = visible (deep title),
//                 +headerHeight = hidden (tab-root mode).
//   burgerRot     BurgerArrowIcon group rotation (deg). 0 = hamburger,
//                 180 = back-arrow; values between are the live morph.
//   deepTrackTx   NavPipelineHost track translateX (px) on a deep page.
//   tabTrackTx    NavPipelineTabHost track translateX (px) on a tab root.
//   fabScale      [data-testid="fab"] computed scale (matrix a).
//   fractionalIndex / backMorph / tapMorph / transitionTarget  primary pager
//                 store live values (the orchestrator's per-frame publication).
//   activePill    the aria-current="page" tab pill href, or null when no pill.

export interface MultiSignalFrame {
	t: number;
	path: string;
	hdrTrackTx: number | null;
	rootLayerTy: number | null;
	deepLayerTy: number | null;
	burgerRot: number | null;
	deepTrackTx: number | null;
	tabTrackTx: number | null;
	fabScale: number | null;
	fractionalIndex: number | null;
	backMorph: number | null;
	tapMorph: number | null;
	transitionTarget: string | null;
	activePill: string | null;
}

interface MultiSignalWindow extends Window {
	__ms?: { frames: MultiSignalFrame[]; done: boolean };
}

interface PrimaryPagerRead {
	fractionalIndex: number;
	backMorph: number | null;
	tapMorph: number | null;
	transitionTarget: string | null;
}

/**
 * Install a rAF sampler that records the multi-signal bundle each frame for
 * `windowMs`. Call before triggering the gesture/animation, then drive the
 * gesture, then await `waitForMultiSignalDone` and read with
 * `readMultiSignalFrames`.
 */
export async function installMultiSignalSampler(page: Page, windowMs: number): Promise<void> {
	await page.evaluate(
		(windowMs) => {
			const w = window as unknown as MultiSignalWindow;
			w.__ms = { frames: [], done: false };
			const start = performance.now();
			const txOf = (el: Element | null): number | null => {
				if (!el) return null;
				try {
					return new DOMMatrix(getComputedStyle(el).transform).m41;
				} catch {
					return null;
				}
			};
			const tyOf = (el: Element | null): number | null => {
				if (!el) return null;
				const tr = getComputedStyle(el).transform;
				if (tr === 'none') return 0;
				try {
					return new DOMMatrix(tr).m42;
				} catch {
					return null;
				}
			};
			const burgerRot = (): number | null => {
				const g = document.querySelector('header svg mask g') as HTMLElement | null;
				if (!g) return null;
				const m = g.style.transform.match(/rotate\(([-\d.]+)deg\)/);
				return m ? parseFloat(m[1]) : 0;
			};
			const tick = (): void => {
				const pp = (window as unknown as { __primaryPager?: PrimaryPagerRead }).__primaryPager;
				// The two stacked layers inside the title slot: [0] = root (tab
				// bar), [1] = deep (title). Both carry an inline translateY.
				const layers = document.querySelectorAll(
					'header div.relative.h-10.flex-1 > div.absolute.inset-0'
				);
				const deepCentre = document.querySelector('.detail-scroll-pane');
				const hdrTrack = document.querySelector('header div.flex.w-\\[200\\%\\]');
				const pill = document.querySelector(
					'header nav a[data-tab-nav][aria-current="page"]'
				);
				const fab = document.querySelector('[data-testid="fab"]');
				let fabScale: number | null = null;
				if (fab) {
					const m = getComputedStyle(fab).transform.match(/matrix\(([^)]+)\)/);
					fabScale = m ? Number(m[1].split(',')[0]) : 1;
				}
				w.__ms!.frames.push({
					t: Math.round(performance.now() - start),
					path: location.pathname,
					hdrTrackTx: txOf(hdrTrack),
					rootLayerTy: tyOf(layers[0] ?? null),
					deepLayerTy: tyOf(layers[1] ?? null),
					burgerRot: burgerRot(),
					deepTrackTx: txOf(deepCentre ? deepCentre.parentElement : null),
					tabTrackTx: txOf(document.querySelector('[data-testid="nav-pipeline-tab-track"]')),
					fabScale,
					fractionalIndex: pp ? pp.fractionalIndex : null,
					backMorph: pp ? pp.backMorph : null,
					tapMorph: pp ? pp.tapMorph : null,
					transitionTarget: pp ? pp.transitionTarget : null,
					activePill: pill ? pill.getAttribute('href') : null
				});
				if (performance.now() - start > windowMs) {
					w.__ms!.done = true;
					return;
				}
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		},
		windowMs
	);
}

/** Await the multi-signal sampler's window elapsing. */
export async function waitForMultiSignalDone(page: Page, timeout = 10_000): Promise<void> {
	await page.waitForFunction(
		() => (window as unknown as MultiSignalWindow).__ms?.done === true,
		{ timeout }
	);
}

/** Read the captured multi-signal frames (call after `waitForMultiSignalDone`). */
export async function readMultiSignalFrames(page: Page): Promise<MultiSignalFrame[]> {
	return page.evaluate(() => {
		const w = window as unknown as MultiSignalWindow;
		return w.__ms?.frames ?? [];
	});
}

// --- Slow / held CDP touch drag ---------------------------------------------
// `swipeBack`/`swipeForward` fire a fast gesture that lands past SWIPE_COMMIT in
// one burst. The drag-sync tests need to (a) capture mid-drag frames (so the
// rAF sampler sees the finger-move window) and (b) HOLD the finger down without
// releasing (so all sampled frames are during-drag, not post-release). This
// helper drives a configurable CDP touch sequence with a per-step delay and an
// optional hold (no touchEnd).

export interface SlowTouchDragOpts {
	startX: number;
	endX: number;
	/** touchMove dispatch count (higher = slower, more mid-drag frames). */
	steps?: number;
	/** ms waited after each touchStart/touchMove so rAF samplers keep up. */
	stepDelayMs?: number;
	/** touch y coordinate. */
	y?: number;
	/** when true, do NOT dispatch touchEnd (hold the drag mid-gesture). */
	hold?: boolean;
	/** when holding, ms to wait (finger down) before returning. */
	holdMs?: number;
}

/**
 * Drive a horizontal CDP touch drag with per-step timing. `hold: true` leaves
 * the finger down (no touchEnd) so a sampler records pure during-drag frames.
 */
export async function slowTouchDrag(page: Page, opts: SlowTouchDragOpts): Promise<void> {
	const {
		startX,
		endX,
		steps = 24,
		stepDelayMs = 28,
		y = 400,
		hold = false,
		holdMs = 400
	} = opts;
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', {
		enabled: true,
		maxTouchPoints: 5
	});
	const dispatch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, state: string) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y, id: 1 }] as unknown as never,
			modifiers: 0,
			timestamp: 0
		});
	await dispatch('touchStart', startX, 'touchPressed');
	await page.waitForTimeout(stepDelayMs);
	for (let i = 1; i <= steps; i++) {
		const x = Math.round(startX + (endX - startX) * (i / steps));
		await dispatch('touchMove', x, 'touchMoved');
		await page.waitForTimeout(stepDelayMs);
	}
	if (hold) {
		await page.waitForTimeout(holdMs);
	} else {
		await dispatch('touchEnd', endX, 'touchReleased');
	}
	await client.detach();
}

// --- Animation jank + curve analyzer (pure) ---------------------------------
// Given a series of `{ t, value }` samples (a subset of MultiSignalFrame
// projected onto one signal), characterize the active animation window: its
// duration, the rAF frame cadence (mean + worst interval), the largest
// single-frame jump, and whether the curve decelerates (ease-out, snappy) vs.
// runs linear / accelerating (feels sluggish). Used by the search-enter and
// header-back-button jank tests. Pure (no Page), so it runs in the test
// process over frames read back from the page.

export interface AnimationAnalysis {
	/** ms from the first moving frame to the last moving frame. */
	durationMs: number;
	/** total rAF frames in the active window. */
	frameCount: number;
	/** frames whose value moved more than `epsilon` from the previous frame. */
	movingFrameCount: number;
	/** mean rAF interval (ms) across the active window. ~16 at 60fps. */
	meanIntervalMs: number;
	/** worst rAF interval (ms) across the active window. A jank spike. */
	maxIntervalMs: number;
	/** largest absolute single-frame value delta (a "jump"). */
	maxDelta: number;
	/** total value distance covered (|last - first| of the active window). */
	travel: number;
	/** mean |delta| of the active window's first half minus its second half.
	 *  Positive => the animation front-loads its motion (ease-out, decelerates,
	 *  feels snappy). Near zero => linear. Negative => accelerates (ease-in,
	 *  feels draggy / sluggish at the start). */
	deceleration: number;
}

/**
 * Characterize the active animation in a sampled series. The active window is
 * the span from the first frame whose value moved more than `epsilon` to the
 * last such frame. Frames outside it (idle tail / head) are excluded.
 */
export function analyzeAnimation(
	frames: { t: number; value: number | null }[],
	epsilon = 1
): AnimationAnalysis {
	const series = frames.filter((f): f is { t: number; value: number } => f.value !== null);
	if (series.length < 2) {
		return {
			durationMs: 0,
			frameCount: series.length,
			movingFrameCount: 0,
			meanIntervalMs: 0,
			maxIntervalMs: 0,
			maxDelta: 0,
			travel: 0,
			deceleration: 0
		};
	}
	const absDelta = (i: number): number => Math.abs(series[i].value - series[i - 1].value);
	let first = -1;
	let last = -1;
	for (let i = 1; i < series.length; i++) {
		if (absDelta(i) > epsilon) {
			if (first === -1) first = i - 1;
			last = i;
		}
	}
	if (first === -1) {
		return {
			durationMs: 0,
			frameCount: series.length,
			movingFrameCount: 0,
			meanIntervalMs: 0,
			maxIntervalMs: 0,
			maxDelta: 0,
			travel: 0,
			deceleration: 0
		};
	}
	const span = series.slice(first, last + 1);
	const intervals: number[] = [];
	const deltas: number[] = [];
	for (let i = 1; i < span.length; i++) {
		intervals.push(span[i].t - span[i - 1].t);
		deltas.push(Math.abs(span[i].value - span[i - 1].value));
	}
	const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
	const half = Math.floor(deltas.length / 2);
	const firstHalfMean = half > 0 ? mean(deltas.slice(0, half)) : mean(deltas);
	const secondHalfMean = half > 0 ? mean(deltas.slice(half)) : 0;
	return {
		durationMs: span[span.length - 1].t - span[0].t,
		frameCount: span.length,
		movingFrameCount: deltas.filter((d) => d > epsilon).length,
		meanIntervalMs: mean(intervals),
		maxIntervalMs: intervals.length ? Math.max(...intervals) : 0,
		maxDelta: deltas.length ? Math.max(...deltas) : 0,
		travel: Math.abs(span[span.length - 1].value - span[0].value),
		deceleration: firstHalfMean - secondHalfMean
	};
}

/** Range (max - min) of a numeric signal over the given frames. */
export function signalRange<F>(
	frames: F[],
	pick: (f: F) => number | null
): { range: number; min: number; max: number; first: number | null; last: number | null } {
	const vals = frames.map(pick).filter((v): v is number => v !== null);
	if (vals.length === 0) return { range: 0, min: 0, max: 0, first: null, last: null };
	return {
		range: Math.max(...vals) - Math.min(...vals),
		min: Math.min(...vals),
		max: Math.max(...vals),
		first: vals[0],
		last: vals[vals.length - 1]
	};
}

// --- CPU throttle + Long Animation Frames (authoritative jank) --------------
// Two tools the rAF-interval proxy lacks:
//  - `withCpuThrottle` slows the page's CPU via CDP Emulation so main-thread-
//    bound jank surfaces as on a mobile-class device (desktop Chromium is far
//    faster than a real phone and hides device jank).
//  - The Long Animation Frames API (PerformanceObserver 'long-animation-frame')
//    is the browser's own flag for render frames whose total work exceeded
//    ~50ms, carrying the offending script. Authoritative for main-thread render
//    jank and names the cause; under throttle it reproduces the reported severe
//    frame drops that a desktop rAF sampler misses.

export interface LoafEntry {
	/** Frame start, ms from time origin. */
	startTime: number;
	/** Total frame work, ms. >50 means the browser flagged it long. */
	duration: number;
	/** Time the frame blocked other input, ms. */
	blockingDuration: number;
	/** Source URL of the heaviest script in the frame. */
	scriptUrl: string | null;
	/** Function name of the heaviest script (best effort). */
	scriptFn: string | null;
	/** Self ms of the heaviest script. */
	scriptMs: number | null;
}

interface LoafWindow extends Window {
	__loaf?: LoafEntry[];
	__loafObs?: PerformanceObserver;
}

/** Install (or reset) a Long Animation Frames observer capturing every long
 *  render frame from now on. */
export async function resetLoaf(page: Page): Promise<void> {
	await page.evaluate(() => {
		const w = window as unknown as LoafWindow;
		try {
			w.__loafObs?.disconnect();
		} catch {
			/* ignore */
		}
		w.__loaf = [];
		const obs = new PerformanceObserver((list) => {
			for (const e of list.getEntries() as unknown as Array<Record<string, unknown>>) {
				const scripts = ((e.scripts as Array<Record<string, unknown>>) ?? []).slice();
				scripts.sort((a, b) => Number(b.duration ?? 0) - Number(a.duration ?? 0));
				const top = scripts[0];
				w.__loaf!.push({
					startTime: Number(e.startTime),
					duration: Number(e.duration),
					blockingDuration: Number(e.blockingDuration ?? 0),
					scriptUrl: (top?.sourceURL as string) ?? null,
					scriptFn:
						(top?.sourceFunctionName as string) ??
						(top?.invoker as string) ??
						null,
					scriptMs: top ? Number(top.duration) : null
				});
			}
		});
		obs.observe({ type: 'long-animation-frame', buffered: false });
		w.__loafObs = obs;
	});
}

/** Read the captured long-animation-frame entries (call after the animation). */
export async function readLoaf(page: Page): Promise<LoafEntry[]> {
	return page.evaluate(() => (window as unknown as LoafWindow).__loaf ?? []);
}

/** Run `fn` with the page CPU throttled to `rate` (e.g. 4 = 4x slower), then
 *  restore 1x. The throttle applies to the whole page target, so in-page
 *  observers (LoAF, rAF samplers) see the throttled execution. */
export async function withCpuThrottle<T>(
	page: Page,
	rate: number,
	fn: () => Promise<T>
): Promise<T> {
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setCPUThrottlingRate', { rate });
	try {
		return await fn();
	} finally {
		await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
		await client.detach();
	}
}
