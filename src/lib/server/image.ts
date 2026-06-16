/**
 * Shared image-format detection from magic bytes. Used by:
 *   - the import script (to route cwebp vs gif2webp  - the crawler mislabels files)
 *   - the upload route (to verify the real type of incoming bytes, since the
 *     client-provided Content-Type cannot be trusted)
 *
 * `head` is the first ~12 bytes of the file (read from disk, or the first chunk
 * of a stream). Returns 'other' for anything that is not a recognized image.
 */
export type ImageFormat = 'gif' | 'png' | 'jpeg' | 'webp' | 'avif' | 'bmp' | 'other';

export function detectImageFormat(head: Uint8Array): ImageFormat {
	if (head.length >= 3 && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) {
		return 'gif'; // GIF8
	}
	if (
		head.length >= 4 &&
		head[0] === 0x89 &&
		head[1] === 0x50 &&
		head[2] === 0x4e &&
		head[3] === 0x47
	) {
		return 'png';
	}
	if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
		return 'jpeg';
	}
	if (head.length >= 2 && head[0] === 0x42 && head[1] === 0x4d) {
		return 'bmp';
	}
	if (
		head.length >= 12 &&
		head[0] === 0x52 &&
		head[1] === 0x49 &&
		head[2] === 0x46 &&
		head[3] === 0x46 &&
		head[8] === 0x57 &&
		head[9] === 0x45 &&
		head[10] === 0x42 &&
		head[11] === 0x50
	) {
		return 'webp'; // RIFF....WEBP
	}
	// AVIF: ISOBMFF 'ftyp' box (bytes 4-7) with an AVIF major brand (bytes 8-11):
	// 'avif' (image), 'avis' (sequence), or 'mif1' (HEIF generic, used by some
	// AVIF encoders). Matches the AVIF support advertised in the UI.
	if (
		head.length >= 12 &&
		head[4] === 0x66 &&
		head[5] === 0x74 &&
		head[6] === 0x79 &&
		head[7] === 0x70 &&
		((head[8] === 0x61 &&
			head[9] === 0x76 &&
			head[10] === 0x69 &&
			(head[11] === 0x66 || head[11] === 0x73)) || // 'avif' / 'avis'
			(head[8] === 0x6d && head[9] === 0x69 && head[10] === 0x66 && head[11] === 0x31)) // 'mif1'
	) {
		return 'avif';
	}
	return 'other';
}

/** MIME type for a format (null for non-images). */
export function mimeForFormat(format: ImageFormat): string | null {
	switch (format) {
		case 'gif':
			return 'image/gif';
		case 'png':
			return 'image/png';
		case 'jpeg':
			return 'image/jpeg';
		case 'webp':
			return 'image/webp';
		case 'avif':
			return 'image/avif';
		case 'bmp':
			return 'image/bmp';
		default:
			return null;
	}
}
