/**
 * Client-safe image MIME → file-extension helper (no server-only deps). Shared
 * by the server upload route and the client Avatar component so avatar/attachment
 * URLs carry a real extension, which lets CDN edge caches that key on file
 * extensions (Cloudflare's default cacheable set) treat them as static assets
 * without a cache-everything rule. Parameters (e.g. `;charset=`) and case are
 * normalized.
 */
export function extFromMime(mime: string | null): string | null {
	const base = (mime ?? '').toLowerCase().split(';')[0].trim();
	switch (base) {
		case 'image/webp':
			return 'webp';
		case 'image/jpeg':
			return 'jpg';
		case 'image/png':
			return 'png';
		case 'image/gif':
			return 'gif';
		case 'image/avif':
			return 'avif';
		case 'image/bmp':
			return 'bmp';
		case 'image/svg+xml':
			return 'svg';
		default:
			return null;
	}
}

/**
 * Build the avatar URL string (with a real file extension) from the raw user
 * columns. Centralizes URL + extension derivation so callers - both server DAOs
 * (online) and the client offline mapper (IDB) - ship a ready URL and the
 * Avatar component needs no content-type plumbing or extension logic. Returns
 * null when the user has no avatar (letter fallback). Client-safe (pure).
 */
export function buildAvatarUrl(
	userId: number,
	avatarFileId: string | null,
	contentType: string | null
): string | null {
	if (!avatarFileId) return null;
	return `/avatar/${userId}/${avatarFileId}.${extFromMime(contentType) ?? 'webp'}`;
}
