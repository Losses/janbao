import type { SearchSort } from '$lib/types/search';

/**
 * The source-query fields a search-scope cache entry carries, for
 * freshness comparison. The field names (`query`, `sort`) match
 * `PageCacheSource` exactly so a `PageCacheSource` can be passed
 * directly without a mapping layer. Both optional: an entry with
 * `query === undefined` is never fresh (the panel reloads).
 */
export interface SearchCacheEntrySource {
	query?: string;
	sort?: string;
}

/**
 * A cached entry is fresh only when its source `(query, sort)` matches
 * the current query. Otherwise it is a stale miss and the panel reloads.
 * Pure so it is unit-testable. The SearchScopePager delegates to this.
 */
export function isSearchEntryFresh(
	entry: SearchCacheEntrySource | null,
	query: string,
	sort: SearchSort
): boolean {
	return entry !== null && entry.query === query && entry.sort === sort;
}
