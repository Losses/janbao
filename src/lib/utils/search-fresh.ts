import type { SearchSort } from '$lib/types/search';

/** The source-query fields every search-cache entry carries, for freshness
 *  comparison. Kept here (not imported from the store) so the helper is pure and
 *  unit-testable without the store's `$state`. */
export interface SearchCacheEntrySource {
	q: string;
	sort: SearchSort;
}

/**
 * A cached entry is fresh only when its source `(q, sort)` matches the current
 * query - otherwise it is a stale miss and the panel reloads. Pure so it is
 * unit-testable; `SearchCacheStore.isFresh` delegates here.
 */
export function isSearchEntryFresh(
	entry: SearchCacheEntrySource | null,
	q: string,
	sort: SearchSort
): boolean {
	return entry !== null && entry.q === q && entry.sort === sort;
}
