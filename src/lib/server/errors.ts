import { json } from '@sveltejs/kit';
import type en from '$lib/i18n/en.json';

type TranslationDict = typeof en;

/**
 * Resolve a dot-notated i18n key from the translation dictionary.
 * Returns `undefined` if the path cannot be fully resolved.
 */
function resolve(t: TranslationDict, key: string): string | undefined {
	const parts = key.split('.');
	let node: unknown = t;
	for (const part of parts) {
		if (node === null || node === undefined || typeof node !== 'object') return undefined;
		node = (node as Record<string, unknown>)[part];
	}
	return typeof node === 'string' ? node : undefined;
}

/**
 * Return a standardised JSON error response for API endpoints.
 *
 * Usage: `return jsonError(t, 'common.unauthorized', 401);`
 *
 * Resolves the i18n key from the translation dictionary and wraps it in
 * `{ error: message }` with the given HTTP status code.
 */
export function jsonError(t: TranslationDict, key: string, status: number): Response {
	const message = resolve(t, key) ?? key;
	return json({ error: message }, { status });
}
