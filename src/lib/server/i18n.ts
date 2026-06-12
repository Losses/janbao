import en from '../i18n/en.json';
import zhCN from '../i18n/zh-CN.json';

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
