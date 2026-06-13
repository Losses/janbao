import en from '../i18n/en.json';
import zhCN from '../i18n/zh-CN.json';
import type { TranslationDict } from '$lib/types/translation';

const dictionaries: Record<string, typeof en> = {
	en: en,
	'zh-CN': zhCN
};

export function getTranslation(lang: string) {
	return dictionaries[lang] || dictionaries['en'];
}

export function resolveLang(
	acceptLanguageHeader: string | null,
	dbUserLang: string | null
): string {
	if (dbUserLang === 'en' || dbUserLang === 'zh-CN') {
		return dbUserLang;
	}
	if (!acceptLanguageHeader) return 'en';

	const locales = acceptLanguageHeader.split(',').map((item) => {
		const parts = item.split(';');
		const locale = parts[0].trim();
		return locale;
	});

	for (const locale of locales) {
		if (locale.startsWith('zh')) {
			return 'zh-CN';
		}
		if (locale.startsWith('en')) {
			return 'en';
		}
	}
	return 'en';
}

interface CategoryRecord {
	slug: string;
	title: string;
	description: string;
	[key: string]: unknown;
}

/**
 * Resolve i18n overrides for a category. If the translation dictionary
 * contains a `category.<slug>.title` / `description` entry, it replaces
 * the database value; otherwise the original record is returned as-is.
 */
export function resolveCategoryI18n(cat: CategoryRecord, t: TranslationDict): CategoryRecord {
	const group = (t.category as Record<string, unknown>)[cat.slug] as
		| { title?: string; description?: string }
		| undefined;

	if (!group) return cat;

	return {
		...cat,
		title: group.title ?? cat.title,
		description: group.description ?? cat.description
	};
}

/**
 * Apply i18n overrides to an array of categories.
 */
export function resolveCategoriesI18n(
	cats: CategoryRecord[],
	t: TranslationDict
): CategoryRecord[] {
	return cats.map((c) => resolveCategoryI18n(c, t));
}
