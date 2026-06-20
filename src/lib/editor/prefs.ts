// Editor preferences domain model (shared, SSR-safe). Mirrors the
// `$lib/offline/prefs` split: the pure type + defaults live here, importable
// from both the server DAO and the client store; the reactive wrapper lives in
// `$lib/stores/editor-prefs.svelte.ts`.
//
// Backed by the `editor_preferences` table (1:1 per user). A missing row
// resolves to DEFAULT_EDITOR_PREFERENCES - every feature on, plain-text mode off.

/**
 * A user's rich-text editor preferences. Field names mirror the
 * `editor_preferences` columns and the Lexical feature they gate. The
 * `plainMode` master switch overrides every feature flag (all features read as
 * off when it is on).
 */
export interface EditorPreferences {
	plainMode: boolean;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	strikethrough: boolean;
	highlight: boolean;
	spoiler: boolean;
	headings: boolean;
	quote: boolean;
	codeBlock: boolean;
	bulletList: boolean;
	numberedList: boolean;
	checklist: boolean;
	link: boolean;
	autolink: boolean;
	image: boolean;
	markdown: boolean;
}

/**
 * The per-feature toggle keys, excluding the `plainMode` master. Drives the
 * settings-page toggle list and the API write-validation allowlist (the master
 * is validated separately so the page can submit it alongside the features).
 */
export const EDITOR_FEATURE_KEYS = [
	'bold',
	'italic',
	'underline',
	'strikethrough',
	'highlight',
	'spoiler',
	'headings',
	'quote',
	'codeBlock',
	'bulletList',
	'numberedList',
	'checklist',
	'link',
	'autolink',
	'image',
	'markdown'
] as const;

/** The plain-text master switch key (validated apart from the feature keys). */
export const PLAIN_MODE_KEY = 'plainMode' as const;

/** All features enabled, plain-text mode off - the state for a fresh account. */
export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
	plainMode: false,
	bold: true,
	italic: true,
	underline: true,
	strikethrough: true,
	highlight: true,
	spoiler: true,
	headings: true,
	quote: true,
	codeBlock: true,
	bulletList: true,
	numberedList: true,
	checklist: true,
	link: true,
	autolink: true,
	image: true,
	markdown: true
};
