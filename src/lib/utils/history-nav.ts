/**
 * history-nav - decide how to reach a tab route without growing the history
 * stack. Shared by every tab-switch entry point (MobileTabPager swipe,
 * MobileTabBar tap) so toggling between two tabs (B <-> A) collapses to a hop
 * (history.back / history.forward) instead of pushing a new entry each time -
 * which would otherwise make the user unable to browser-back out of the app.
 *
 * Pure (runes-free): reads only the global Navigation History API. Returns
 * 'push' when that API is unavailable, so old browsers keep the
 * push-on-every-switch behaviour (progressive enhancement). The same function
 * also backs the thread back-swipe's "does the previous entry match" check
 * (GesturePageLayout / thread-nav).
 *
 * Direction-agnostic: it only asks "which adjacent entry equals the target",
 * never "which way the finger moved" - so a left or right swipe that targets a
 * tab whose entry sits behind (back) or ahead (forward) of the current one both
 * resolve correctly, with back taking precedence when both neighbours match.
 *
 * Note: a 'forward' hop resurrects the original entry verbatim, including any
 * ?page query it carried - a (welcome) improvement over always landing on the
 * tab root.
 */
export type HistoryHop = 'back' | 'forward' | 'push';

/**
 * How to navigate to `href` without adding a redundant history entry:
 *  - 'back'    the previous entry's pathname already equals `href` -> history.back()
 *  - 'forward' the next entry's pathname equals `href` -> history.forward()
 *  - 'push'    neither neighbour matches (or the Navigation API is absent)
 *              -> push a new entry
 *
 * Comparison is pathname-only (matching the original backLandsOn checks), so a
 * tab route matches regardless of ?page / search.
 */
export function hopForHref(href: string): HistoryHop {
	if (typeof navigation === 'undefined') return 'push';
	const cur = navigation.currentEntry;
	if (!cur) return 'push';
	const entries = navigation.entries();
	const target = pathnameOf(href);
	if (target === null) return 'push';
	if (cur.index > 0) {
		const prev = entries[cur.index - 1];
		if (prev && pathnameOf(prev.url) === target) return 'back';
	}
	if (cur.index < entries.length - 1) {
		const next = entries[cur.index + 1];
		if (next && pathnameOf(next.url) === target) return 'forward';
	}
	return 'push';
}

/**
 * Pathname of an entry URL, or null if it is missing. Absolute URLs (real
 * Navigation API entries) resolve via URL(); relative references (a tab href
 * like "/activity", which URL() rejects without an origin) are used verbatim
 * as a pathname with any ?search stripped, so "/?page=2" matches "/".
 */
function pathnameOf(url: string | null): string | null {
	if (url === null) return null;
	try {
		return new URL(url).pathname;
	} catch {
		const queryIndex = url.indexOf('?');
		return queryIndex === -1 ? url : url.slice(0, queryIndex);
	}
}
