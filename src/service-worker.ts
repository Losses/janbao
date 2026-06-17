/// <reference types="@sveltejs/kit" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />

/**
 * Janbao service worker.
 *
 * Responsibilities:
 * - Precache the app shell: SvelteKit hashed build chunks (`build`) plus static
 *   files (`files`: manifest, icons, offline.html, ...), keyed by deploy version.
 * - Navigations: network-first with a short timeout, falling back to the cached
 *   document for that URL, then the cached app shell, then `/offline.html`.
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
const OFFLINE_URL = '/offline.html';
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
		event.respondWith(handleNavigate(request));
		return;
	}
	event.respondWith(handleAsset(request));
});

async function handleNavigate(request: Request): Promise<Response> {
	try {
		const network = await fetchWithTimeout(request, NAV_TIMEOUT_MS);
		const cache = await caches.open(CACHE);
		// Only cache successful same-origin documents so a transient 4xx/5xx
		// can't poison the offline cache.
		if (network.ok && network.type === 'basic') {
			await cache.put(request, network.clone());
		}
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

async function handleAsset(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE);
	const cached = await cache.match(request);
	if (cached) return cached;
	try {
		const network = await fetch(request);
		if (network.ok && network.type === 'basic') cache.put(request, network.clone());
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
