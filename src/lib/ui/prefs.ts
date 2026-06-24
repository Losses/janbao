// Interface preferences domain model (shared, SSR-safe). Mirrors the
// `$lib/editor/prefs` split: the pure type + defaults live here, importable
// from both the server DAO and the client store; the reactive wrapper lives
// in `$lib/stores/ui-prefs.svelte.ts`.
//
// Backed by the `ui_preferences` table (1:1 per user). A missing row resolves
// to DEFAULT_UI_PREFERENCES - no theme override, post themes honored.

import type { TranslationDict } from '$lib/types/translation';

/**
 * A user's interface preferences. Field names mirror the `ui_preferences`
 * columns. `interfaceTheme` is the site-wide theme override (empty = site
 * default); `blockPostTheme` makes per-discussion themes stop applying.
 */
export interface UiPreferences {
	interfaceTheme: string;
	blockPostTheme: boolean;
}

/** Empty theme + post themes honored - the state for a fresh account / guest. */
export const DEFAULT_UI_PREFERENCES: UiPreferences = {
	interfaceTheme: '',
	blockPostTheme: false
};

/** Keys that form the API write allowlist (every settable field). */
export const UI_PREF_KEYS = ['interfaceTheme', 'blockPostTheme'] as const;

/** A theme option rendered in a <select>. `value` is the daisyUI theme name. */
export interface ThemeOption {
	value: string;
	label: string;
}

/** Resolve the i18n label for a theme value, falling back to the value itself. */
type ThemeLabelResolver = (value: string) => string;

/**
 * The canonical theme list shared by the post/edit discussion forms and the
 * Appearance settings page. The first entry is always the site default
 * (empty value), followed by every daisyUI theme in the i18n `theme` section.
 * `resolveLabel` takes the i18n `t` so labels render in the user's language.
 */
export function buildThemeOptions(t: TranslationDict): ThemeOption[] {
	const themeT = t.theme;
	const resolveLabel: ThemeLabelResolver = (value) => {
		if (value === '') return themeT.defaultTheme;
		return themeT[value as keyof typeof themeT] ?? value;
	};
	return THEME_VALUES.map((value) => ({ value, label: resolveLabel(value) }));
}

/**
 * Every theme value offered, in display order. The empty string leads (site
 * default), then the daisyUI themes. Kept as a plain array so the list is the
 * single source of truth - `buildThemeOptions` just maps i18n labels onto it,
 * and the API validates writes against it.
 */
export const THEME_VALUES = [
	'',
	'light',
	'dark',
	'cupcake',
	'bumblebee',
	'emerald',
	'corporate',
	'synthwave',
	'retro',
	'cyberpunk',
	'valentine',
	'halloween',
	'garden',
	'forest',
	'aqua',
	'lofi',
	'pastel',
	'fantasy',
	'wireframe',
	'black',
	'luxury',
	'dracula',
	'cmyk',
	'autumn',
	'business',
	'acid',
	'lemonade',
	'night',
	'coffee',
	'winter',
	'dim',
	'nord',
	'sunset',
	'caramellatte',
	'abyss',
	'silk'
] as const;

/** Set form for O(1) "is this a valid interface theme value" checks. */
export const VALID_INTERFACE_THEMES: ReadonlySet<string> = new Set(THEME_VALUES);
