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
// GesturePageLayout plays a list→thread slide-in when a discussion is reached
// from `/` (shouldAnimateEnter): the track starts at translateX(0%) and animates
// to translateX(-33.3%) over ~200ms. We sample the track's computed translateX
// to prove the animation ran - the only behavioural signal that the transition
// animated. The regression test for the tab-tap-return bug relies on this: a
// stale thread entry in the nav stack suppresses the slide-in (the track is born
// already centred and never moves).

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
 * GesturePageLayout track translated (i.e. the slide-in played). The sampler
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
		const afterFrame = (): Promise<void> =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			).then(() => sleep(40));
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
