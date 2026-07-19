import { hopForHref } from '$lib/utils/history-nav';

/**
 * Thread-Nav Context - cross-component signals for navigations involving a
 * discussion thread (`/discussion/*`). Written by the root layout's
 * beforeNavigate; module-level (NOT reactive) because it is written once per
 * navigation and read on a gesture/commit.
 *
 *  - enterFromList (one-shot): set when a navigation goes `/` → `/discussion/*`.
 *    The list→thread forward slide-in runs through NavPipelineHost's onMount
 *    `orchestrator.configure({ fromPathname, backTarget, ... })` call, which
 *    derives the slide from the route pair directly; the flag records the
 *    navigation's provenance for any consumer that needs it. Reset on read;
 *    false on SSR / reload / non-list entry.
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
	if (typeof navigation === 'undefined') return reachedFromList;
	// hopForHref inspects navigation.entries() to decide back/forward/push; we
	// only care whether the previous entry is the discussions list.
	return hopForHref('/') === 'back';
}
