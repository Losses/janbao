import { SvelteURL } from 'svelte/reactivity';

/**
 * Thread-Nav Context - cross-component signals for navigations involving a
 * discussion thread (`/discussion/*`). Written by the root layout's
 * beforeNavigate and read by ThreadPager; module-level (NOT reactive) because it
 * is written once per navigation and read on a gesture/commit.
 *
 *  - enterFromList (one-shot): set when a navigation goes `/` → `/discussion/*`.
 *    ThreadPager consumes it on mount to play a forward push slide-in (the list
 *    neighbour slides out as the thread slides in), mirroring the back-swipe.
 *    Reset on read; false on SSR / reload / non-list entry.
 */
let enterFromList = false;

export function markEnterFromList(): void {
	enterFromList = true;
}

export function consumeEnterFromList(): boolean {
	const value = enterFromList;
	enterFromList = false;
	return value;
}

/**
 * `reachedFromList` is the FALLBACK for backLandsOnList() on browsers without
 * the Navigation API. Set on every thread arrival to whether that navigation
 * originated from `/`. Correct for this app's push-only list→thread flow (there
 * is no out-of-band pushState/replaceState on the thread route to desync it).
 * Defaults false, and beforeNavigate never fires on a full load, so a
 * deep-linked / reloaded thread can never back() out of the site.
 */
let reachedFromList = false;

export function setReachedFromList(value: boolean): void {
	reachedFromList = value;
}

/**
 * True iff going back one history entry from the current thread would land on the
 * discussions list (`/`) - so the swipe-back gesture can pop the entry
 * (history.back) instead of pushing a duplicate (goto).
 *
 * Prefers the native Navigation API, which exposes the ACTUAL previous entry's
 * URL, so this is a direct check (not an inference) on every browser that ships
 * it. No polyfill: on browsers without the Navigation API `navigation` is
 * undefined and we fall back to reachedFromList. A polyfill would only re-derive
 * that same flag there (it maintains its entries list by patching
 * history.pushState/replaceState), so it is not more direct than the fallback -
 * hence omitted unless we standardise on the Navigation API elsewhere.
 */
export function backLandsOnList(): boolean {
	if (typeof navigation !== 'undefined') {
		const cur = navigation.currentEntry;
		// entries()[cur.index - 1] is the true back destination even when forward
		// entries exist (currentEntry.index is the position within the full list).
		if (cur && cur.index > 0) {
			const prev = navigation.entries()[cur.index - 1];
			if (prev && prev.url !== null) {
				try {
					return new SvelteURL(prev.url).pathname === '/';
				} catch {
					return false;
				}
			}
		}
		return false;
	}
	return reachedFromList;
}
