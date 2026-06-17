import type en from '$lib/i18n/en.json';

type TranslationDict = typeof en;

export type { TranslationDict };

/**
 * Getter for the resolved app locale ('en' | 'zh-CN'). Published by the root
 * layout via Svelte context (key 'app:lang') so locale-aware atoms can format
 * absolute timestamps in the user's language. Exposed as a getter so it stays
 * current if the layout load re-runs with a different locale.
 */
export type LocaleGetter = () => string;
