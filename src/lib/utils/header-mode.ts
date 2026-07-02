import { getCurrentTabIndex } from '$lib/utils/route-config';

/**
 * header-mode - the path-derived Header mode discriminator. Mirrors
 * `deep-header-config.ts` (a pure, runes-free pathname matcher) but returns
 * which of the three Header layers is active at rest, rather than a title.
 *
 *   - 'root'   a primary tab route (`/`, `/activity`, `/discussion/*`, ...) -
 *              the tab bar + hamburger + search icon are shown.
 *   - 'deep'   a no-tab-highlight route (`getCurrentTabIndex === -1`) that is
 *              not /search - back-arrow + title.
 *   - 'search' `/search` - the search layer (magnifier-left + input + filter).
 *
 * Pure and runes-free (no $state) so it is SSR-safe. The Header reads it via
 * `resolveHeaderMode(page.url.pathname)`; the morph progress itself comes from
 * the pager store's `backMorph`.
 */
export type HeaderMode = 'root' | 'deep' | 'search';

export function resolveHeaderMode(pathname: string): HeaderMode {
	if (pathname === '/search' || pathname.startsWith('/search')) return 'search';
	if (getCurrentTabIndex(pathname) === -1) return 'deep';
	return 'root';
}
