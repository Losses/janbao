import { getCurrentTabIndex } from '$lib/utils/route-config';

/**
 * header-mode - the path-derived Header mode discriminator. Mirrors
 * `deep-header-config.ts` (a pure, runes-free pathname matcher) but
 * returns which of the three Header layers is active at rest, rather
 * than a title.
 *
 *   - 'root'   a tab-highlighted route (`getCurrentTabIndex >= 0`) -
 *              the tab bar + hamburger + search icon are shown.
 *   - 'deep'   a no-tab-highlight route that is not /search - back-arrow
 *              + title.
 *   - 'search' `/search` - the search layer (magnifier-left + input + filter).
 *
 * `docs/DV20-Plan.md` §3 lists `headerMode(r)` as derived: tag alone
 * (`tag === 'tab' ? 'root' : tag === 'search' ? 'search' : 'deep'`).
 * That derivation is the TARGET. In Cycle 1 the tab-bar config still
 * surfaces tab-association for thread / conversation / compose routes
 * (they inherit the source list's pill, so the Header continues to
 * render the tab bar on a thread), so `headerMode` reads the tab-bar
 * config via `getCurrentTabIndex` to preserve that behaviour. The
 * tag-only derivation lands in a later cycle when the resolver takes
 * over Header morph.
 *
 * Pure and runes-free (no $state) so it is SSR-safe. The Header reads
 * it via `resolveHeaderMode(page.url.pathname)`; the morph progress
 * itself comes from the pager store's `backMorph`.
 */
export type HeaderMode = 'root' | 'deep' | 'search';

export function resolveHeaderMode(pathname: string): HeaderMode {
	// Prefix-match `/search` (any path starting with `/search`) so the
	// search branch covers both exact `/search` and any hypothetical
	// `/searchFoo` path uniformly. No `/search` sub-route exists today;
	// the prefix form is the broadest reasonable interpretation.
	if (pathname === '/search' || pathname.startsWith('/search')) return 'search';
	if (getCurrentTabIndex(pathname) === -1) return 'deep';
	return 'root';
}
