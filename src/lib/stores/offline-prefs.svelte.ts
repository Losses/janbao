// DV07 C03 - reactive wrapper around `offline/prefs.ts` (the pure, SSR-safe
// localStorage layer). Mirrors the `online.svelte.ts` singleton pattern:
// module-level `$state`, getter-based API so consumers observe live updates.
// The pure layer owns validation; this layer owns reactivity + persistence.
//
// Initialization is EAGER, gated on `browser` ($app/environment): on the client
// the store reads localStorage once at module-import time, BEFORE any component
// or `$derived` runs. This matters because the settings page reads `prefs`
// inside `$derived(...)` blocks - a lazy "hydrate on first read" getter would
// mutate `$state` during a `$derived` evaluation, which Svelte 5 rejects
// (state_unsafe_mutation). Eager init means a `prefs` read never mutates.
// During SSR `browser` is false, so we use defaults without touching localStorage.

import { browser } from '$app/environment';
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

// Module-level reactive cell. Always defined: real prefs on the client
// (read once at import), DEFAULT_OFFLINE_PREFS during SSR (no localStorage).
let state: OfflinePrefs = $state(browser ? readOfflinePrefs() : DEFAULT_OFFLINE_PREFS);

function update(partial: Partial<OfflinePrefs>): void {
	// Shallow-merge top-level fields, with a deep-ish merge for the categories
	// sub-object so callers can flip a single category without restating the
	// others (matches how the settings UI calls it).
	const nextCategories =
		partial.categories !== undefined
			? { ...state.categories, ...partial.categories }
			: state.categories;
	const next: OfflinePrefs = { ...state, ...partial, categories: nextCategories };
	state = next;
	writeOfflinePrefs(next);
}

function reset(): void {
	state = { ...DEFAULT_OFFLINE_PREFS };
	writeOfflinePrefs(state);
}

export function getOfflinePrefsStore(): OfflinePrefsStore {
	return {
		get prefs() {
			return state;
		},
		update,
		reset
	};
}
