import type { SearchSort } from '$lib/types/search';

/**
 * The source-query fields a search-scope cache entry carries, for
 * freshness comparison. Kept here (not imported from the page-cache
 * store) so the helper is pure and unit-testable without the store's
 * `$state`. `q` and `sort` are optional to match `PageCacheSource`'s
 * shape; an entry with `q === undefined` is never fresh (the panel
 * reloads). `sort` is typed as a plain string so any source's sort
 * field is assignable here; the live comparison still checks equality
 * against the caller's `SearchSort`.
 */
export interface SearchCacheEntrySource {
	q?: string;
	sort?: string;
}

/**
 * A cached entry is fresh only when its source `(q, sort)` matches the
 * current query. Otherwise it is a stale miss and the panel reloads.
 * Pure so it is unit-testable. The SearchScopePager delegates to this.
 */
export function isSearchEntryFresh(
	entry: SearchCacheEntrySource | null,
	q: string,
	sort: SearchSort
): boolean {
	return entry !== null && entry.q === q && entry.sort === sort;
}
