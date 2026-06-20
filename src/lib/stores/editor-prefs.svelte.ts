// Editor Prefs Store - module-level reactive cache of the signed-in user's
// rich-text editor preferences. Seeded from the session: the root layout
// hydrates it from `data.user.editorPreferences`, and the settings page calls
// update() after a successful save so every live LexicalEditor instance
// re-derives its feature flags without a reload.
//
// No localStorage: the server (editor_preferences row) is the source of truth,
// and the session already carries the prefs on every request. Guests and the
// pre-hydrate SSR pass keep DEFAULT_EDITOR_PREFERENCES, which reads as
// every-feature-on (the un-customized rich-text experience). The lazy editor
// chunk loads after the root layout's hydrate effect runs, so live editors see
// the real prefs on first render - no flash.

import { DEFAULT_EDITOR_PREFERENCES, type EditorPreferences } from '$lib/editor/prefs';

type HydrateFn = (prefs: EditorPreferences) => void;
type UpdateFn = (partial: Partial<EditorPreferences>) => void;

interface EditorPrefsStore {
	readonly prefs: EditorPreferences;
	hydrate: HydrateFn;
	update: UpdateFn;
}

// Module-level reactive cell. Defaults until the root layout hydrates it from
// the session; stays at defaults for guests (no session).
let state: EditorPreferences = $state({ ...DEFAULT_EDITOR_PREFERENCES });

function hydrate(prefs: EditorPreferences): void {
	// Replace (not merge) so a session change fully resets stale prefs.
	state = { ...prefs };
}

function update(partial: Partial<EditorPreferences>): void {
	state = { ...state, ...partial };
}

export function getEditorPrefsStore(): EditorPrefsStore {
	return {
		get prefs() {
			return state;
		},
		hydrate,
		update
	};
}
