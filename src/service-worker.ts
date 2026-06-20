/// <reference types="@sveltejs/kit" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />

/**
 * Janbao service worker.
 *
 * Responsibilities:
 * - Precache the app shell: SvelteKit hashed build chunks (`build`) plus static
 *   files (`files`: manifest, icons, offline-fallback.html, ...), keyed by deploy version.
 * - Navigations: network-first with a short timeout, falling back to the cached
 *   document for that URL, then the cached app shell, then `/offline-fallback.html`.
 *   The fallback file is named `offline-fallback.html` (not `offline.html`)
 *   deliberately: SvelteKit serves static files extensionless, so
 *   `static/offline.html` would also be served at `/offline` and shadow the
 *   offline-reader route (static files win over routes). The `-fallback` suffix
 *   keeps it out of the `/offline` namespace.
 *   This is what lets the offline reader route (C02) boot with no network.
 * - Static assets: cache-first.
 * - API (`/api/*`): never cached - sync cursors especially must not read stale.
 *
 * Runs identically on Cloudflare (adapter-auto) and Bun/Node (adapter-node): both
 * serve `/service-worker.js` from the static/build output, and a SW is pure
 * browser-side code that does not touch the backend.
 */
import { build, files, version } from '$service-worker';

// The project tsconfig loads the DOM lib, where the global `self` is `Window`.
// In a service worker the runtime global is ServiceWorkerGlobalScope; pin it here
// so skipWaiting/clients/FetchEvent type-check in the editor as well as the build.
declare const self: ServiceWorkerGlobalScope;

const CACHE = `janbao-${version}`;
const OFFLINE_URL = '/offline-fallback.html';
const SHELL_URL = '/';
const NAV_TIMEOUT_MS = 3000;

// Hashed JS/CSS chunks + everything under static/.
const PRECACHE: readonly string[] = [...build, ...files];

self.addEventListener('install', (event: ExtendableEvent) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			// Put each asset individually so one missing optional file can't reject
			// the whole install (addAll is all-or-nothing).
			await Promise.all(
				PRECACHE.map(async (url) => {
					try {
						const res = await fetch(new Request(url, { cache: 'reload' }));
						if (res.ok) await cache.put(url, res);
					} catch {
						// Optional asset; ignore.
					}
				})
			);
			await self.skipWaiting();
		})()
	);
});

self.addEventListener('activate', (event: ExtendableEvent) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event: FetchEvent) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	// Only handle same-origin GETs; cross-origin (avatars, pCloud media, push
	// services) passes through untouched.
	if (url.origin !== self.location.origin) return;
	// Never cache API responses.
	if (url.pathname.startsWith('/api/')) return;

	if (request.mode === 'navigate') {
		event.respondWith(handleNavigate(event));
		return;
	}
	// SvelteKit data fetches (…/__data.json) carry the session cookie and are
	// user-specific, so they must NEVER be served cache-first: a response
	// captured during a logged-out visit would otherwise be replayed on every
	// subsequent visit, making the user appear logged out (e.g. on /offline).
	// Network-first keeps them fresh online; the cache fallback preserves the
	// last good response when offline.
	if (url.pathname.endsWith('/__data.json')) {
		event.respondWith(handleData(event));
		return;
	}
	event.respondWith(handleAsset(event));
});

// Push event: the application server POSTed an encrypted aes128gcm record to
// the push service; the browser decrypted it and hands us the JSON payload we
// originally encrypted ({title, body, url, tag}). We surface it as a system
// notification. `showNotification` requires a visible notification per the
// `userVisibleOnly:true` contract the subscription was created under.
interface PushEventPayload {
	title?: string;
	body?: string;
	url?: string;
	tag?: string;
}

self.addEventListener('push', (event: PushEvent) => {
	let payload: PushEventPayload = {};
	try {
		payload = event.data ? (event.data.json() as PushEventPayload) : {};
	} catch (err) {
		console.error('[sw] malformed push payload:', err);
	}
	const title = payload.title || 'Janbao';
	const options: NotificationOptions = {
		body: payload.body || '',
		icon: '/icons/icon-192.png',
		badge: '/icons/icon-192.png',
		data: { url: payload.url || '/' },
		tag: payload.tag
	};
	event.waitUntil(self.registration.showNotification(title, options));
});

// notificationclick: focus an already-open client at the target URL if one
// exists, otherwise open a new one. Always close the notification so it does
// not linger in the system tray after the user has acted on it.
self.addEventListener('notificationclick', (event: NotificationEvent) => {
	event.notification.close();
	const targetUrl = (event.notification.data && event.notification.data.url) || '/';
	event.waitUntil(focusOrOpenClient(targetUrl));
});

async function focusOrOpenClient(targetUrl: string): Promise<void> {
	const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
	for (const c of allClients) {
		// Match on pathname so a different origin/hashes don't trip us up.
		try {
			const candidateUrl = new URL(c.url, self.location.origin);
			if (candidateUrl.pathname === new URL(targetUrl, self.location.origin).pathname) {
				await c.focus();
				return;
			}
		} catch {
			// Malformed client URL; skip and try the next.
		}
	}
	await self.clients.openWindow(targetUrl);
}

// Write a successful same-origin response into the precache. Guards the
// offline copy against being poisoned by a transient 4xx/5xx or an
// opaque/cross-origin response. Intended to run inside event.waitUntil so the
// SW stays alive until the write finishes without blocking the response.
async function cacheResponse(request: Request, response: Response): Promise<void> {
	if (!response.ok || response.type !== 'basic') return;
	const cache = await caches.open(CACHE);
	await cache.put(request, response);
}

async function handleNavigate(event: FetchEvent): Promise<Response> {
	const { request } = event;
	try {
		const network = await fetchWithTimeout(request, NAV_TIMEOUT_MS);
		// Update the cached document in the background so the response is
		// returned as soon as the network resolves; waitUntil extends the SW
		// lifetime until the write finishes so the offline fallback stays current.
		event.waitUntil(cacheResponse(request, network.clone()));
		return network;
	} catch {
		const cache = await caches.open(CACHE);
		return (
			(await cache.match(request)) ??
			(await cache.match(SHELL_URL)) ??
			(await cache.match(OFFLINE_URL)) ??
			new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
		);
	}
}

// SvelteKit data endpoint (…/__data.json): network-first so user-specific
// responses (auth state) are never served stale. Falls back to the last cached
// response when offline.
async function handleData(event: FetchEvent): Promise<Response> {
	const { request } = event;
	try {
		const network = await fetch(request);
		// Background write-through (see handleNavigate): keeps the user-specific
		// __data.json fresh online without holding the response open until the
		// cache write completes.
		event.waitUntil(cacheResponse(request, network.clone()));
		return network;
	} catch {
		const cache = await caches.open(CACHE);
		return (await cache.match(request)) ?? new Response('', { status: 504 });
	}
}

async function handleAsset(event: FetchEvent): Promise<Response> {
	const { request } = event;
	const cache = await caches.open(CACHE);
	const cached = await cache.match(request);
	if (cached) return cached;
	try {
		const network = await fetch(request);
		// Fill the cache in the background; waitUntil keeps the SW alive until
		// the write finishes.
		event.waitUntil(cacheResponse(request, network.clone()));
		return network;
	} catch {
		return new Response('', { status: 504 });
	}
}

async function fetchWithTimeout(request: Request, ms: number): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ms);
	try {
		return await fetch(request, { signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}
