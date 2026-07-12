import { MOBILE_TAB_DEFS } from '$lib/utils/tab-config';

/**
 * history-nav - decide how to reach a tab route without growing the history
 * stack. Shared by every tab-switch entry point (NavPipelineTabHost swipe,
 * MobileTabBar tap) so toggling between two tabs (B <-> A) collapses to a hop
 * (history.back / history.forward) instead of pushing a new entry each time -
 * which would otherwise make the user unable to browser-back out of the app.
 *
 * Pure (runes-free): reads only the global Navigation History API. Returns
 * 'push' when that API is unavailable, so old browsers keep the
 * push-on-every-switch behaviour (progressive enhancement). The same function
 * also backs the thread back-swipe's "does the previous entry match" check
 * (NavPipelineHost / thread-nav).
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
 * The tab-root pathnames, derived from the shared tab config so this never
 * hardcodes the site's routes (add/reorder a tab in tab-config and every check
 * here follows). A "tab root" is one of the primary tab routes
 * NavPipelineTabHost owns (`/`, `/activity`, `/messages/inbox`); everything else
 * (a thread, a profile, /bookmarks, /search, ...) is a DEEP page.
 */
const TAB_ROOT_PATHNAMES: readonly string[] = MOBILE_TAB_DEFS.map((tab) => tab.href);

/** True iff `pathname` is exactly one of the tab-root (pager) routes. */
export function isTabRootPath(pathname: string): boolean {
	return TAB_ROOT_PATHNAMES.includes(pathname);
}

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
 * The pathname of the history entry immediately BEHIND the current one, or null
 * when there is no previous entry (or the Navigation API is unavailable). Reads
 * only the global Navigation History API, so it is stub-able in unit tests the
 * same way `hopForHref` is.
 */
export function previousEntryPathname(): string | null {
	if (typeof navigation === 'undefined') return null;
	const cur = navigation.currentEntry;
	if (!cur || cur.index <= 0) return null;
	const prev = navigation.entries()[cur.index - 1];
	return prev ? pathnameOf(prev.url) : null;
}

/**
 * Should a back-swipe performed on a TAB page pop real history
 * (`history.back()`) instead of switching to the spatially-previous tab?
 *
 * True iff the entry behind the current tab is a DEEP page - i.e. the user
 * reached this tab by forward-swiping from a thread / profile / bookmarks /
 * search / ... (any non-tab-root route). In that case "back" must return to that
 * originating page; switching to the previous tab root would strand it (the
 * thread sits between the tab and its root in history, and hopForHref only
 * inspects the adjacent entry, so the tab switch would push the root and skip
 * the thread). When the previous entry IS a tab root (normal tab <-> tab use),
 * the spatial switch is correct and this returns false.
 *
 * The discriminator is `isTabRootPath` (config-driven), so this is agnostic to
 * which deep route is involved - no route is hardcoded.
 */
export function backSwipeShouldPopHistory(targetTabIdx: number): boolean {
	const prev = previousEntryPathname();
	if (prev === null) return false;
	if (isTabRootPath(prev)) return false;

	const idx = MOBILE_TAB_DEFS.findIndex((tab) => tab.isActive(prev));
	const prevTabIdx = idx >= 0 ? idx : 0;
	return prevTabIdx === targetTabIdx;
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
