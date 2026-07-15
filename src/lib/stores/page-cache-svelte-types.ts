// src/lib/stores/page-cache-svelte-types.ts
/**
 * Type declarations for the unified PageCacheStore. Lives in a `.ts`
 * file (runes-free) so the pure logic module (`page-cache-logic.ts`)
 * and the unit suite can import them without a Svelte compiler pass.
 * The reactive store (`page-cache.svelte.ts`) re-exports these for
 * consumers.
 */

/**
 * The opaque shape of a page's server payload as far as the store is
 * concerned. The store does not inspect or narrow `data`; consumers
 * cast to the typed shape via the route-keyed lookup.
 *
 * Typed as `unknown` (not an index signature) so any concrete
 * interface is assignable without each shape having to declare an
 * index signature. Consumers narrow with a direct cast, e.g.
 * `entry.data as DiscussionsListCacheData | null`.
 */
export type UnknownPageData = unknown;

/**
 * Where a cache entry came from. Consumers compare this against the
 * live query to decide freshness (e.g. a search panel reloads when
 * `query` or `sort` changes).
 */
export interface PageCacheSource {
	/** The pathname that produced this entry. Usually equal to the
	 * cache key's pathname; recorded separately so a consumer can
	 * verify the entry was sourced from the route it expects. */
	readonly route: string;
	readonly query?: string;
	readonly sort?: string;
	readonly page?: number;
}

/**
 * The cache entry value.
 */
export interface PageCacheEntry {
	data: UnknownPageData | null;
	scrollTop: number;
	source: PageCacheSource;
	capturedAt: number;
}

/**
 * The partial shape passed to `capture`. Every field is optional; the
 * store merges the input into the existing entry (preserving fields
 * the caller did not touch) so a scroll capture does not overwrite
 * `data` and a data capture does not reset `scrollTop`. The store
 * supplies `capturedAt` and a default `source` when the caller omits
 * it.
 */
export interface PageCacheCaptureInput {
	data?: UnknownPageData | null;
	scrollTop?: number;
	source?: PageCacheSource;
}

/**
 * A pluggable source the store can consult when `get` misses. The
 * online default is "no source" (the cache is populated by `capture`
 * calls from page layouts). Cycle 6 registers an IDB-backed source so
 * `/offline/*` routes resolve through the same store interface.
 */
export interface PageCacheDataSource {
	/** Whether this source owns entries for the given key. The first
	 * registered source that claims a key serves it. */
	isResponsibleFor(pathname: string, subKey: string | undefined): boolean;
	/** Fetch the data for the key. May be sync or async. Returns `null`
	 * to signal a miss; the store falls through to the next source. */
	read(
		pathname: string,
		subKey: string | undefined
	): Promise<UnknownPageData | null> | UnknownPageData | null;
}
