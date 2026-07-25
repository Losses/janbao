// src/lib/offline/offline-page-cache-source.ts
/**
 * The IDB-backed `PageCacheDataSource` for the offline reader routes.
 *
 * The unified `PageCacheStore` (Cycle 2) has a data-source-agnostic read
 * interface: a pluggable source can be registered, and `ensure(pathname,
 * subKey)` does a cache-then-source lookup. The online routes populate the
 * cache via `capture` calls from page layouts (their data comes from
 * SvelteKit's `load`). The offline reader's data comes from IndexedDB, so
 * the read path is wrapped as a source instead: the first `ensure` for an
 * offline pathname falls through to this module, which delegates to the
 * IDB loaders in `$lib/offline/queries` (`loadOfflineDiscussions`,
 * `loadOfflineActivity`, `loadOfflineBookmarks`). The IDB reads are
 * wrapped, not replaced.
 *
 * The source owns the three offline LIST pathnames. The thread route
 * `/offline/[discussionId]` keeps its own `+page.ts` `load` (it carries
 * `ssr = false` and reads IDB itself); the cache source is not responsible
 * for it.
 *
 * Registration is idempotent and eager: the first import of this module
 * pushes the source onto the singleton store's source list. No Dexie code
 * runs at registration time (the source's `read` is what calls the IDB
 * loaders); SSR importing this module is safe because `ensure` is never
 * called on the server (no `onMount` runs there). Each offline LIST route
 * component statically imports this module for the side-effect, so the
 * source is registered before the route's `onMount` calls `ensure`.
 */
import { getPageCacheStore } from '$lib/stores/page-cache.svelte';
import type { PageCacheDataSource } from '$lib/stores/page-cache-svelte-types';
import { loadOfflineActivity, loadOfflineBookmarks, loadOfflineDiscussions } from './queries';

/**
 * The pathname set this source owns. Kept in one place so `isResponsibleFor`
 * and `read` agree on the routing.
 */
function isOfflineListPathname(pathname: string): boolean {
	return (
		pathname === '/offline' || pathname === '/offline/activity' || pathname === '/offline/bookmarks'
	);
}

/**
 * The IDB-backed source. `read` delegates to the IDB loaders in
 * `$lib/offline/queries`, returning the view shapes the list components
 * render (`OfflineDiscussionView[]`, `ActivityListItem[]`,
 * `OfflineBookmarkView[]`). A miss returns `null` so the store falls
 * through to the next source (there is none today, so a miss surfaces as
 * `null` to the caller, which the route components render as the empty
 * state).
 */
export const offlinePageCacheSource: PageCacheDataSource = {
	isResponsibleFor(pathname: string): boolean {
		return isOfflineListPathname(pathname);
	},
	async read(pathname: string): Promise<unknown> {
		if (pathname === '/offline') return await loadOfflineDiscussions();
		if (pathname === '/offline/activity') return await loadOfflineActivity();
		if (pathname === '/offline/bookmarks') return await loadOfflineBookmarks();
		return null;
	}
};

let registered = false;

/**
 * Idempotently register the IDB source with the singleton `PageCacheStore`.
 * Safe to call from any context (client or SSR); the registration is a pure
 * push onto the store's source array.
 */
export function registerOfflinePageCacheSource(): void {
	if (registered) return;
	getPageCacheStore().registerSource(offlinePageCacheSource);
	registered = true;
}

// Eager registration on first module load. The offline route components
// statically import this module, so the source is in place before any of
// them calls `pageCache.ensure`.
registerOfflinePageCacheSource();
