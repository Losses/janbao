// DV07: client-side offline caching preferences (decision #1 - prefs are local
// only, never sent to the server DB). This module is intentionally
// NON-reactive: it reads/writes localStorage directly. The reactive store
// (`offline-prefs.svelte.ts`) is layered on top in C03 so this layer stays
// pure and SSR-testable.

// localStorage key. Namespaced under the app prefix to match other client
// caches; the shape is versioned by the OfflinePrefs interface itself (a
// schema bump would land a v2 key rather than mutate the stored value).
export const OFFLINE_PREFS_STORAGE_KEY = 'janbao:offline-prefs:v1';

// Curated category toggles. Each corresponds to a server DiscussionSort the
// user wants page-1 ids cached + refreshed on schedule. All default off: a
// guest or a fresh install has no curated cache (the !enabled / no-categories
// path is byte-identical to DV06).
export interface OfflineCategoryToggles {
	latest: boolean;
	mostViewed: boolean;
	mostReplied: boolean;
}

// Reply depth policy (decision #3):
//   'first'      - page 1 only.
//   'firstLast'  - page 1 + last page (DV06 default behavior).
//   'all'        - every page if ≤1000 replies, otherwise first 250 + last 250.
export type OfflineReplyDepth = 'first' | 'firstLast' | 'all';

// Scheduled curated-refresh frequency (C05). 1/2/3/5/7 days.
export type OfflineRefreshIntervalDays = 1 | 2 | 3 | 5 | 7;

export interface OfflinePrefs {
	enabled: boolean;
	categories: OfflineCategoryToggles;
	depth: OfflineReplyDepth;
	refreshIntervalDays: OfflineRefreshIntervalDays;
	// Read passthrough (C04): when on, online browse data is written back to
	// the offline store tagged with reason 'read'. Default on so the cache
	// self-populates from normal usage; only the curated path is gated on
	// `enabled`.
	passthrough: boolean;
}

// Default = feature off, no categories, DV06 depth, daily refresh, passthrough
// on. readOfflinePrefs returns this whenever stored state is missing or fails
// validation.
export const DEFAULT_OFFLINE_PREFS: OfflinePrefs = {
	enabled: false,
	categories: { latest: false, mostViewed: false, mostReplied: false },
	depth: 'firstLast',
	refreshIntervalDays: 1,
	passthrough: true
};

const VALID_DEPTHS: readonly OfflineReplyDepth[] = ['first', 'firstLast', 'all'];
const VALID_INTERVALS: readonly OfflineRefreshIntervalDays[] = [1, 2, 3, 5, 7];

function isValidDepth(value: unknown): value is OfflineReplyDepth {
	return typeof value === 'string' && (VALID_DEPTHS as readonly string[]).includes(value);
}

function isValidInterval(value: unknown): value is OfflineRefreshIntervalDays {
	return typeof value === 'number' && (VALID_INTERVALS as readonly number[]).includes(value);
}

// Coerce an unknown parsed value into a valid OfflinePrefs, falling back to
// the default for any missing/invalid field. A row that doesn't validate at
// all (not an object, wrong shape) yields the full default so a corrupted
// localStorage entry can never crash the orchestrator.
function coercePrefs(raw: unknown): OfflinePrefs {
	if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_OFFLINE_PREFS };
	const obj = raw as Record<string, unknown>;

	const categoriesRaw = obj['categories'];
	const categories: OfflineCategoryToggles =
		typeof categoriesRaw === 'object' && categoriesRaw !== null
			? {
					latest: Boolean((categoriesRaw as Record<string, unknown>)['latest']),
					mostViewed: Boolean((categoriesRaw as Record<string, unknown>)['mostViewed']),
					mostReplied: Boolean((categoriesRaw as Record<string, unknown>)['mostReplied'])
				}
			: { ...DEFAULT_OFFLINE_PREFS.categories };

	return {
		enabled: Boolean(obj['enabled']),
		categories,
		depth: isValidDepth(obj['depth']) ? obj['depth'] : DEFAULT_OFFLINE_PREFS.depth,
		refreshIntervalDays: isValidInterval(obj['refreshIntervalDays'])
			? obj['refreshIntervalDays']
			: DEFAULT_OFFLINE_PREFS.refreshIntervalDays,
		passthrough:
			obj['passthrough'] === undefined
				? DEFAULT_OFFLINE_PREFS.passthrough
				: Boolean(obj['passthrough'])
	};
}

/**
 * Read offline prefs from localStorage, validating shape. Returns defaults on
 * any parse error / missing key. SSR-safe: typeof localStorage guard returns
 * defaults on the server (the orchestrator only runs client-side anyway, but
 * the guard lets this module be imported in a server-rendered route tree
 * without throwing).
 */
export function readOfflinePrefs(): OfflinePrefs {
	if (typeof localStorage === 'undefined') return { ...DEFAULT_OFFLINE_PREFS };
	try {
		const raw = localStorage.getItem(OFFLINE_PREFS_STORAGE_KEY);
		if (raw === null) return { ...DEFAULT_OFFLINE_PREFS };
		return coercePrefs(JSON.parse(raw));
	} catch {
		return { ...DEFAULT_OFFLINE_PREFS };
	}
}

/** Persist prefs to localStorage. Throws-through on quota / serialization errors. */
export function writeOfflinePrefs(prefs: OfflinePrefs): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(OFFLINE_PREFS_STORAGE_KEY, JSON.stringify(prefs));
}
