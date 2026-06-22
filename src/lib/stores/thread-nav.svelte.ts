import { SvelteURL } from 'svelte/reactivity';

/**
 * Thread-Nav - cross-component signals for navigations involving a thread
 * overlay (`/discussion/*` or `/messages/[id]`) over the persistent MobileTabPager.
 * Written by the root layout's beforeNavigate and read by ThreadPager; module-level
 * (NOT reactive) because it is written once per navigation and read on a gesture/init.
 *
 *  - enterFromList (one-shot): set when a navigation goes list → thread overlay
 *    (`/` → `/discussion/*` or `/messages/inbox` → `/messages/[id]`). ThreadPager
 *    consumes it on mount to play a forward push slide-in (the list neighbour
 *    slides out as the thread slides in), mirroring the back-swipe. Reset on read;
 *    false on SSR / reload / non-list entry, so snapIndex defaults to ACTIVE then.
 *
 *  - previousEntryIs(href): history introspection for the back-swipe's
 *    history.back vs goto decision (no history-stack bloat when the prior entry is
 *    the list). Uses the native Navigation API; false on browsers without it.
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

/** True iff the history entry immediately before the current one is `href` (by pathname). */
export function previousEntryIs(href: string): boolean {
	if (typeof navigation === 'undefined') return false;
	const cur = navigation.currentEntry;
	if (!cur || cur.index <= 0) return false;
	const prev = navigation.entries()[cur.index - 1];
	if (!prev || prev.url === null) return false;
	try {
		return new SvelteURL(prev.url).pathname === new SvelteURL(href, location.origin).pathname;
	} catch {
		return false;
	}
}
