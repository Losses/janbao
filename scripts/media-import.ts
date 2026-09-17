import { createHash } from 'node:crypto';
import { convertToWebp } from './import-shared';
import {
	avatarStorageEntry,
	avatarStoragePath,
	mediaGetObject,
	mediaUploadBytes,
	type MediaStorageConfig
} from '../src/lib/server/media-storage';
import { detectImageFormat, mimeForFormat } from '../src/lib/server/image';

export interface ImportedAvatar {
	fileId: string;
	contentType: string;
}

async function existingAvatar(cfg: MediaStorageConfig, path: string): Promise<ImportedAvatar> {
	const stored = await mediaGetObject(cfg, path);
	const bytes = new Uint8Array(await new Response(stored.body).arrayBuffer());
	const contentType = mimeForFormat(detectImageFormat(bytes.subarray(0, 12)));
	if (!contentType) throw new Error(`Stored avatar has an unsupported image format: ${path}`);
	return {
		fileId: createHash('sha256').update(bytes).digest('hex'),
		contentType
	};
}

/** Return metadata for the bytes that actually exist in the media provider. */
export async function importAvatar(
	cfg: MediaStorageConfig,
	userId: number | string,
	source: string,
	existing: Set<string>
): Promise<ImportedAvatar> {
	const entry = avatarStorageEntry(userId);
	// Avatar objects use the user ID as their filename for compatibility with
	// the existing pCloud layout. Read an existing object so metadata always
	// describes its actual bytes rather than an unuploaded local crawl file.
	const path = avatarStoragePath(userId);
	if (existing.has(entry)) return existingAvatar(cfg, path);
	const bytes = convertToWebp(source);
	const result: ImportedAvatar = {
		fileId: createHash('sha256').update(bytes).digest('hex'),
		contentType: 'image/webp'
	};
	await mediaUploadBytes(cfg, path, bytes, result.contentType);
	existing.add(entry);
	return result;
}
