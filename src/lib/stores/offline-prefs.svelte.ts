// DV07 C03 - reactive wrapper around `offline/prefs.ts` (the pure, SSR-safe
// localStorage layer). Mirrors the `online.svelte.ts` singleton pattern:
// module-level `$state`, lazy-initialized on first getter access (NOT at module
// load, so importing the store during SSR is safe), and a getter-based API so
// consumers observe live updates. The pure layer owns validation; this layer
// owns reactivity + persistence wiring.

import {
	DEFAULT_OFFLINE_PREFS,
	readOfflinePrefs,
	writeOfflinePrefs,
	type OfflinePrefs
} from '$lib/offline/prefs';

type UpdateFn = (partial: Partial<OfflinePrefs>) => void;
type ResetFn = () => void;

interface OfflinePrefsStore {
	readonly prefs: OfflinePrefs;
	update: UpdateFn;
	reset: ResetFn;
}

// Module-level reactive cell. Held as `OfflinePrefs | undefined` until first
// read so SSR module-import (which never touches `prefs`) pays no localStorage
// cost; the first `getOfflinePrefsStore().prefs` access hydrates it.
let state: OfflinePrefs | undefined = $state(undefined);

function ensureHydrated(): OfflinePrefs {
	if (state === undefined) {
		state = readOfflinePrefs();
	}
	return state;
}

function update(partial: Partial<OfflinePrefs>): void {
	const current = ensureHydrated();
	// Shallow-merge top-level fields, with a deep-ish merge for the categories
	// sub-object so callers can flip a single category without restating the
	// others (matches how the settings UI calls it).
	const nextCategories =
		partial.categories !== undefined
			? { ...current.categories, ...partial.categories }
			: current.categories;
	const next: OfflinePrefs = { ...current, ...partial, categories: nextCategories };
	state = next;
	writeOfflinePrefs(next);
}

function reset(): void {
	const next: OfflinePrefs = { ...DEFAULT_OFFLINE_PREFS };
	state = next;
	writeOfflinePrefs(next);
}

export function getOfflinePrefsStore(): OfflinePrefsStore {
	// Touch the getter to hydrate lazily on first read of `prefs`, not here:
	// `getOfflinePrefsStore()` itself is called at component init and must not
	// trigger localStorage I/O during SSR.
	return {
		get prefs() {
			return ensureHydrated();
		},
		update,
		reset
	};
}
