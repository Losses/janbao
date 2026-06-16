/**
 * Minimal HTML escaper for interpolating untrusted/user-controlled text into an
 * HTML context (e.g. email bodies). Escapes the five characters that matter for
 * preventing markup injection: & < > " '.
 */
export function escapeHtml(input: string): string {
	return input
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
