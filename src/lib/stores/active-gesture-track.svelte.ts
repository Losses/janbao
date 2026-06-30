/**
 * Active-Gesture-Track Store - module-singleton bridge that lets an ancestor
 * component read the live gesture track element owned by a descendant
 * (MobileTabPager / GesturePageLayout) without a `getContext` channel (Svelte
 * context flows parent -> child only, and the consumer here is an ancestor).
 *
 * Mirrors the existing reachability pattern of `mobile-pager.svelte.ts` and
 * `navigation.svelte.ts`: closure-scoped `$state`, a module-level fallback and
 * `window.__` mirror, an `initX()` called once from the root layout, writers
 * (set / clear) called by the descendants, and a getter the ancestor reads
 * inside a `$derived` / `$effect` so it tracks reactively. No `setContext` is
 * used (the consumer is above the writer); only the module-fallback + `window.__`
 * + init-at-root portions of the pattern are reused.
 *
 * Named for the gesture concept (the live track of the active gesture surface),
 * not for any consumer. SSR-safe (the getter returns null on the server).
 */

type ActiveTrackHandler = (el: HTMLElement) => void;
type ClearTrackHandler = () => void;
type GetTrackHandler = () => HTMLElement | null;

interface ActiveGestureTrackStore {
	readonly track: HTMLElement | null;
	setActiveTrack: ActiveTrackHandler;
	clearActiveTrack: ClearTrackHandler;
}

declare global {
	interface Window {
		__activeGestureTrack?: ActiveGestureTrackStore;
	}
}

let activeTrack = $state<HTMLElement | null>(null);
let globalActiveGestureTrackFallback: ActiveGestureTrackStore | undefined;

if (typeof window !== 'undefined') {
	if (window.__activeGestureTrack) globalActiveGestureTrackFallback = window.__activeGestureTrack;
}

/**
 * Build the store's writer/getter surface against the closure `$state`. The
 * same closure is shared across the fallback, the `window.__` mirror, and
 * future init calls so a `$derived(getActiveGestureTrack().track)` read in
 * AppShell tracks writes by the descendants.
 */
function createStore(): ActiveGestureTrackStore {
	return {
		get track() {
			return activeTrack;
		},
		setActiveTrack: (el: HTMLElement) => {
			activeTrack = el;
		},
		clearActiveTrack: () => {
			activeTrack = null;
		}
	};
}

/** Seed the module singleton. Called once from the root layout alongside the
 *  other inits. Returns the store for callers that want a direct handle.
 *
 *  The module fallback is set unconditionally (not browser-gated) so SSR can
 *  reach the store: an ancestor consumer calls `getActiveGestureTrack()` during
 *  server render, and the descendants that would `setActiveGestureTrack` only
 *  run their bind `$effect` in the browser. The `window.__` mirror stays
 *  browser-gated (no `window` on the server). */
export function initActiveGestureTrack(): ActiveGestureTrackStore {
	const store = createStore();
	globalActiveGestureTrackFallback = store;
	if (typeof window !== 'undefined') {
		window.__activeGestureTrack = store;
	}
	return store;
}

/** Reach the active-gesture-track store from anywhere (typically an ancestor
 *  of the writers). Throws if `initActiveGestureTrack` has not run. */
export function getActiveGestureTrack(): ActiveGestureTrackStore {
	if (globalActiveGestureTrackFallback) {
		return globalActiveGestureTrackFallback;
	}
	throw new Error(
		'ActiveGestureTrack store not initialized. Call initActiveGestureTrack in +layout.svelte.'
	);
}

/** Convenience writer for descendants that bind the track element. */
export function setActiveGestureTrack(el: HTMLElement): void {
	getActiveGestureTrack().setActiveTrack(el);
}

/** Convenience writer for descendants on destroy / unbind. */
export function clearActiveGestureTrack(): void {
	if (globalActiveGestureTrackFallback) {
		globalActiveGestureTrackFallback.clearActiveTrack();
	}
}

// Re-export the handler types for any consumer that wants them.
export type { ActiveTrackHandler, ClearTrackHandler, GetTrackHandler };
