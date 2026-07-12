// src/lib/stores/page-cache-logic.ts
/**
 * Pure (runes-free) logic for the unified PageCacheStore. Imported by
 * the reactive store (`page-cache.svelte.ts`) and by the unit suite
 * (`page-cache.test.ts`). The split follows the project convention
 * (`navigation-logic.ts` / `navigation.svelte.ts`): the pure half is
 * unit-tested under bun:test (no Svelte compiler), the reactive half
 * is a thin `$state` wrapper that delegates here.
 */

import type {
	PageCacheCaptureInput,
	PageCacheEntry,
	PageCacheSource
} from './page-cache-svelte-types';

/** Default lifetime of an entry. Entries older than this are evicted
 *  on the next `capture`. Generous enough that normal navigation never
 *  evicts a live entry; short enough to bound memory growth from
 *  scroll captures across many pathnames. */
export const DEFAULT_TTL_MS = 30 * 60 * 1000;

/** Default cap on the number of entries. The oldest are evicted when
 *  the cap is exceeded on a `capture`. */
export const DEFAULT_MAX_ENTRIES = 200;

/** A clock function (epoch ms). Used by the store for `capturedAt`
 *  stamps; overridable in tests for deterministic eviction. */
export type PageCacheClockFn = () => number;

/** Per-capture tuning: TTL and entry cap. Passed alongside each
 *  mutation so the store can override per-test without re-creating
 *  the state. */
export interface PageCacheEvictionOptions {
	ttlMs: number;
	maxEntries: number;
}

/** Constructor options for `PageCacheStore`. Pure (no `$state`) so it
 *  can live here and be imported by the unit suite. */
export interface PageCacheStoreOptions {
	/** Override the TTL (ms). Tests use a small value to exercise
	 *  eviction deterministically. */
	ttlMs?: number;
	/** Override the entry cap. Tests use a small value. */
	maxEntries?: number;
	/** Optional clock function for deterministic tests. */
	now?: PageCacheClockFn;
}

/** Internal serialized key for the `(pathname, subKey)` pair. */
export function serializeKey(pathname: string, subKey: string | undefined): string {
	return subKey ? `${pathname}#${subKey}` : pathname;
}

/**
 * Internal state entry: a `PageCacheEntry` plus its serialized key
 * (used by `enforceCap` for stable sort, and by the store for
 * diagnostics).
 */
export interface CapturedEntry extends PageCacheEntry {
	key: string;
}

/** The state record the pure functions operate on. The reactive store
 *  holds this as `$state`; tests construct a fresh `{}`. */
export type PageCacheState = Record<string, CapturedEntry>;

/** Read the entry at `(pathname, subKey)` or `null`. */
export function readEntry(
	state: PageCacheState,
	pathname: string,
	subKey?: string
): CapturedEntry | null {
	const key = serializeKey(pathname, subKey);
	return state[key] ?? null;
}

/**
 * Merge `input` into the entry at `(pathname, subKey)`, preserving
 * fields the caller did not touch. Refreshes `capturedAt` on every
 * call. Runs TTL eviction and enforces the entry cap. Mutates `state`
 * in place; Svelte 5's `$state` proxy notifies on field writes.
 */
export function captureEntry(
	state: PageCacheState,
	pathname: string,
	subKey: string | undefined,
	input: PageCacheCaptureInput,
	opts: PageCacheEvictionOptions,
	now: number
): CapturedEntry {
	const key = serializeKey(pathname, subKey);
	const existing = state[key];
	const merged: CapturedEntry = {
		key,
		data: input.data !== undefined ? input.data : (existing?.data ?? null),
		snippet: input.snippet !== undefined ? input.snippet : existing?.snippet,
		scrollTop: input.scrollTop !== undefined ? input.scrollTop : (existing?.scrollTop ?? 0),
		source: input.source ?? existing?.source ?? ({ route: pathname } satisfies PageCacheSource),
		capturedAt: now
	};
	evictExpired(state, opts.ttlMs, now);
	state[key] = merged;
	enforceCap(state, opts.maxEntries);
	return merged;
}

/**
 * Remove entries. With no arguments, clears every entry. With
 * `pathname` only, removes every entry under that pathname (including
 * all its subKeys). With both, removes the single entry.
 */
export function invalidateEntries(state: PageCacheState, pathname?: string, subKey?: string): void {
	if (pathname === undefined) {
		for (const key of Object.keys(state)) {
			delete state[key];
		}
		return;
	}
	if (subKey === undefined) {
		for (const key of Object.keys(state)) {
			if (key === pathname || key.startsWith(`${pathname}#`)) {
				delete state[key];
			}
		}
		return;
	}
	const key = serializeKey(pathname, subKey);
	delete state[key];
}

/**
 * The most recent entry whose capture included a `snippet`. The only consumer
 * is the dead `MobileTabPager`'s deep-page back-swipe preview (MobileTabPager
 * is unmounted, pending 5b3 deletion), which does not know the destination
 * thread's pathname at gesture start. Returns
 * `null` when no snippet has been captured. O(N) where N is bounded
 * by the entry cap.
 */
export function findLatestWithSnippet(state: PageCacheState): CapturedEntry | null {
	let latest: CapturedEntry | null = null;
	for (const entry of Object.values(state)) {
		if (entry.snippet && (!latest || entry.capturedAt > latest.capturedAt)) {
			latest = entry;
		}
	}
	return latest;
}

/** Evict entries whose `capturedAt` is older than the TTL. */
export function evictExpired(state: PageCacheState, ttlMs: number, now: number): void {
	const threshold = now - ttlMs;
	for (const [key, entry] of Object.entries(state)) {
		if (entry.capturedAt < threshold) {
			delete state[key];
		}
	}
}

/** Enforce the entry cap by evicting the oldest entries. */
export function enforceCap(state: PageCacheState, maxEntries: number): void {
	const keys = Object.keys(state);
	if (keys.length <= maxEntries) return;
	const sortable = keys.map((key) => ({ key, at: state[key].capturedAt }));
	sortable.sort((a, b) => a.at - b.at);
	const excess = sortable.length - maxEntries;
	for (let i = 0; i < excess; i += 1) {
		delete state[sortable[i].key];
	}
}

/** Number of entries currently held. */
export function countEntries(state: PageCacheState): number {
	return Object.keys(state).length;
}
