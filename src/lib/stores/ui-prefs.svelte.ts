// UI Prefs Store - module-level reactive cache of the signed-in user's
// interface preferences (site-wide theme + block-post-theme). Seeded from the
// session: the root layout hydrates it from `data.user.uiPreferences`, and the
// Appearance settings page calls update() after a successful save so the
// theme applies app-wide without a reload.
//
// No localStorage: the server (ui_preferences row) is the source of truth,
// and the session already carries the prefs on every request. Guests and the
// pre-hydrate SSR pass keep DEFAULT_UI_PREFERENCES, which reads as no theme
// override and post themes honored - identical to the un-customized site.

import { DEFAULT_UI_PREFERENCES, type UiPreferences } from '$lib/ui/prefs';

type HydrateFn = (prefs: UiPreferences) => void;
type UpdateFn = (partial: Partial<UiPreferences>) => void;

interface UiPrefsStore {
	readonly prefs: UiPreferences;
	hydrate: HydrateFn;
	update: UpdateFn;
}

// Module-level reactive cell. Defaults until the root layout hydrates it from
// the session; stays at defaults for guests (no session).
let state: UiPreferences = $state({ ...DEFAULT_UI_PREFERENCES });

function hydrate(prefs: UiPreferences): void {
	// Replace (not merge) so a session change fully resets stale prefs.
	state = { ...prefs };
}

function update(partial: Partial<UiPreferences>): void {
	state = { ...state, ...partial };
}

export function getUiPrefsStore(): UiPrefsStore {
	return {
		get prefs() {
			return state;
		},
		hydrate,
		update
	};
}
