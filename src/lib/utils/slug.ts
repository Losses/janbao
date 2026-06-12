export function generateSlug(text: string): string {
	// 1. strip tags & html entity decode
	let cleaned = text.replace(/<[^>]*>?/gm, '');

	// Minimal transliteration mapping
	const urlTranslations: Record<string, string> = {
		Ä: 'Ae',
		Ö: 'Oe',
		Ü: 'Ue',
		ä: 'ae',
		ö: 'oe',
		ü: 'ue',
		ß: 'ss',
		А: 'A',
		Б: 'B',
		В: 'V',
		Г: 'G',
		Д: 'D',
		Е: 'E',
		Ё: 'Yo',
		Ж: 'Zh',
		а: 'a',
		б: 'b',
		в: 'v',
		г: 'g',
		д: 'd',
		е: 'e',
		ё: 'yo',
		ж: 'zh'
	};

	cleaned = cleaned
		.split('')
		.map((char) => urlTranslations[char] || char)
		.join('');

	// 2. Strip single quotes
	cleaned = cleaned.replace(/[']/g, '');

	// 3. Replace all non-alphanumeric/spaces with hyphens
	cleaned = cleaned.replace(/[\s\W_]+/g, '-');

	// 4. Squeeze multiple hyphens, convert to lowercase, trim hyphens
	cleaned = cleaned.replace(/-+/g, '-').toLowerCase();

	const result = encodeURIComponent(cleaned.replace(/^-+|-+$/g, ''));
	// Unicode preservation fallback to ensure routing does not break on purely Chinese/Non-Latin titles
	return result || 'discussion';
}
