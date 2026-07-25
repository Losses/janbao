// src/lib/stores/page-cache.svelte.ts
/**
 * Unified PageCacheStore - the single authority for cached page data
 * and scroll positions across the mobile navigation / gesture layer
 * (per `docs/DV20-Plan.md` §7).
 *
 * Consolidates four concerns into one keyed store:
 *   - per-tab list payloads       (keyed by tab root href)
 *   - thread data                 (keyed by thread pathname)
 *   - per-pathname scroll positions (keyed by the pathname)
 *   - per-scope search results     (keyed by `/search`, subKey = scope)
 *
 * Keyed by `(pathname, subKey)`. Value shape:
 *
 *   - `data`      the page's server payload, opaque to the store.
 *                 `null` for scroll-only captures.
 *   - `scrollTop` the per-route scroll position, colocated with the
 *                 data so a stale scrollTop can never apply to the
 *                 wrong content (§7).
 *   - `source`    where the entry came from. Consumers consult this to
 *                 decide freshness; a `(q, sort)` change for a
 *                 search-scope entry is the canonical stale-miss case.
 *   - `capturedAt` epoch milliseconds; used for TTL eviction.
 *
 * The entry's TYPE (tab-list / thread / search-scope / deep) is NOT
 * stored. Consumers narrow `data` by looking up the route via Cycle 1's
 * `RouteData` record, never by reading a stored discriminator.
 *
 * The READ INTERFACE is data-source-agnostic: a pluggable
 * `PageCacheDataSource` can be registered, and `ensure(pathname,
 * subKey)` does a cache-then-source lookup. The offline LIST routes
 * (`/offline`, `/offline/activity`, `/offline/bookmarks`) use `ensure`
 * to read their IDB data through the cache; an IDB-backed source is
 * registered eagerly at module load (`offline-page-cache-source.ts`).
 *
 * SvelteKit's `snapshot` exports on the thread page are retained for
 * cross-reload restoration; that path is orthogonal to this
 * session-scoped store.
 */

import {
	captureEntry,
	countEntries,
	DEFAULT_MAX_ENTRIES,
	DEFAULT_TTL_MS,
	invalidateEntries,
	readEntry
} from './page-cache-logic';
import type { PageCacheClockFn, PageCacheState, PageCacheStoreOptions } from './page-cache-logic';
import type {
	PageCacheCaptureInput,
	PageCacheDataSource,
	PageCacheEntry
} from './page-cache-svelte-types';

export type {
	PageCacheCaptureInput,
	PageCacheDataSource,
	PageCacheEntry,
	PageCacheSource,
	UnknownPageData
} from './page-cache-svelte-types';

export class PageCacheStore {
	/** Reactive state. Reads through `get` (in a `$derived`/`$effect`)
	 *  register as dependents; writes through `capture`/`invalidate`
	 *  notify them. */
	readonly #state = $state<PageCacheState>({});
	readonly #ttlMs: number;
	readonly #maxEntries: number;
	readonly #now: PageCacheClockFn;
	readonly #sources: PageCacheDataSource[] = [];

	constructor(opts: PageCacheStoreOptions = {}) {
		this.#ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
		this.#maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
		this.#now = opts.now ?? (() => Date.now());
	}

	/**
	 * Single writer. Merges `input` into the entry at
	 * `(pathname, subKey)`, preserving fields the caller did not
	 * touch. Refreshes `capturedAt` on every call. Runs TTL eviction
	 * and enforces the entry cap. Delegates the pure merge / eviction
	 * to `page-cache-logic.ts`.
	 */
	capture(pathname: string, subKey: string | undefined, input: PageCacheCaptureInput): void {
		captureEntry(
			this.#state,
			pathname,
			subKey,
			input,
			{ ttlMs: this.#ttlMs, maxEntries: this.#maxEntries },
			this.#now()
		);
	}

	/**
	 * Read the entry at `(pathname, subKey)` or `null`. Sync. Reads
	 * inside a Svelte 5 reactive context (`$derived`, `$effect`)
	 * register as dependents on the underlying state.
	 */
	get(pathname: string, subKey?: string): PageCacheEntry | null {
		return readEntry(this.#state, pathname, subKey);
	}

	/**
	 * Remove entries. With no arguments, clears every entry. With
	 * `pathname` only, removes every entry under that pathname
	 * (including all its subKeys). With both, removes the single
	 * entry.
	 */
	invalidate(pathname?: string, subKey?: string): void {
		invalidateEntries(this.#state, pathname, subKey);
	}

	/**
	 * Register a data source. `ensure` consults registered sources in
	 * registration order; the first one that claims the key serves it.
	 */
	registerSource(source: PageCacheDataSource): void {
		this.#sources.push(source);
	}

	/**
	 * Cache-then-source lookup. Returns the cached entry if present;
	 * otherwise asks each registered source in turn. The first source
	 * that returns non-null data is recorded as a fresh entry (its
	 * `source.route` is the requested `pathname`) and returned. A miss
	 * returns `null`.
	 *
	 * The offline LIST routes call this on mount to read their IDB data.
	 */
	async ensure(pathname: string, subKey: string | undefined): Promise<PageCacheEntry | null> {
		const cached = this.get(pathname, subKey);
		if (cached) return cached;
		for (const source of this.#sources) {
			if (!source.isResponsibleFor(pathname, subKey)) continue;
			const data = await source.read(pathname, subKey);
			if (data === null) continue;
			this.capture(pathname, subKey, { data, source: { route: pathname } });
			return this.get(pathname, subKey);
		}
		return null;
	}

	/** Number of entries currently held. Exposed for tests and
	 *  diagnostics; not used by consumers. */
	get size(): number {
		return countEntries(this.#state);
	}
}

let pageCacheInstance: PageCacheStore | undefined;

/**
 * The single shared `PageCacheStore`. Module singleton, matching the
 * standard store pattern in this directory. No `getContext`/
 * `setContext` (the root layout, an ancestor of every writer, would
 * not be able to read a context a descendant sets).
 */
export function getPageCacheStore(): PageCacheStore {
	if (!pageCacheInstance) {
		pageCacheInstance = new PageCacheStore();
	}
	return pageCacheInstance;
}
