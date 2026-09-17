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

/** Uploaded SHA-256 IDs plus the legacy imported-avatar marker. */
export function isValidAvatarFileId(value: unknown): value is string {
	return typeof value === 'string' && /^(?:[a-f0-9]{64}|1)$/.test(value);
}

const AVATAR_UPLOAD_LOCK_PREFIX = 'upload:';
const AVATAR_UPLOAD_LOCK_PATTERN =
	/^upload:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([a-f0-9]{64}|1|-)$/i;

export interface AvatarUploadLock {
	token: string;
	previousFileId: string | null;
}

/** CAS lock stored in `avatarFileId` while the user-ID object is being replaced. */
export function createAvatarUploadLock(previousFileId: string | null): string {
	const previous = previousFileId && isValidAvatarFileId(previousFileId) ? previousFileId : '-';
	return `${AVATAR_UPLOAD_LOCK_PREFIX}${crypto.randomUUID()}:${previous}`;
}

const LEGACY_AVATAR_UPLOAD_LOCK_PATTERN =
	/^upload:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function parseAvatarUploadLock(value: unknown): AvatarUploadLock | null {
	if (typeof value !== 'string') return null;
	const match = AVATAR_UPLOAD_LOCK_PATTERN.exec(value);
	if (match) {
		return {
			token: match[1],
			previousFileId: match[2] === '-' ? null : match[2]
		};
	}
	const legacy = LEGACY_AVATAR_UPLOAD_LOCK_PATTERN.exec(value);
	if (!legacy) return null;
	return { token: legacy[1], previousFileId: null };
}

/** Pending publication states must never be exposed as public avatar versions. */
export function publicAvatarFileId(value: unknown): string | null {
	if (isValidAvatarFileId(value)) return value;
	return null;
}

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
	// AVIF: ISOBMFF 'ftyp' box (bytes 4-7) with an AVIF-specific major brand
	// (bytes 8-11): 'avif' (image) or 'avis' (sequence). The generic 'mif1' brand
	// is deliberately NOT accepted because it is also the HEIC major brand, which
	// would mislabel HEIC uploads as AVIF.
	if (
		head.length >= 12 &&
		head[4] === 0x66 &&
		head[5] === 0x74 &&
		head[6] === 0x79 &&
		head[7] === 0x70 &&
		head[8] === 0x61 &&
		head[9] === 0x76 &&
		head[10] === 0x69 &&
		(head[11] === 0x66 || head[11] === 0x73) // 'avif' / 'avis'
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
