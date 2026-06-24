import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import type { Page, Cookie } from '@playwright/test';

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

export async function swipeBack(page: Page): Promise<SwipeResult> {
	const client = await page.context().newCDPSession(page);
	await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const width = page.viewportSize()?.width ?? 393;
	// Stay inside the (40, width-40) edge dead-zone; dx well past SWIPE_COMMIT(60);
	// purely horizontal so |dx| > |dy|*1.6.
	const startX = Math.round(width * 0.3);
	const y = 400;
	const endX = startX + 260;
	const steps = 14;

	const dispatch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, state: string) =>
		client.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: [{ state, x, y, id: 1 }],
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
 * beforeNavigate the drawer link ultimately does — so the backTarget
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
 * handleBeforeNavigate — silently changing the backTarget precondition under
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
		// correctly — the same as the real data-tab-nav switchTab path (whose
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
