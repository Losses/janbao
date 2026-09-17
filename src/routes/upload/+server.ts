import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { and, eq, isNull } from 'drizzle-orm';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { RequestHandler } from './$types';
import { jsonError } from '$lib/server/errors';
import { attachments, users } from '$lib/server/db/schema';
import {
	attachmentStoragePath,
	avatarStoragePath,
	mediaStorageConfigurationError,
	resolveMediaStorageConfig
} from '$lib/server/media-storage';
import {
	createAvatarUploadLock,
	isValidAvatarFileId,
	detectImageFormat,
	mimeForFormat,
	publicAvatarFileId
} from '$lib/server/image';
import { buildAvatarUrl, extFromMime } from '$lib/utils/image';
import { publishMediaUpload } from '$lib/server/media-upload';

const MAX_AVATAR = 1 * 1024 * 1024;
const MAX_ATTACHMENT = 5 * 1024 * 1024;

class UploadTooLargeError extends Error {}

async function readUpload(body: ReadableStream<Uint8Array>, maxSize: number): Promise<Uint8Array> {
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const result = await reader.read();
		if (result.done) break;
		size += result.value.byteLength;
		if (size > maxSize) {
			await reader.cancel();
			throw new UploadTooLargeError('upload exceeds size limit');
		}
		chunks.push(result.value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

/**
 * Accept a raw image body, validate its real format and size, hash it, then
 * publish it to the configured media provider. Uploads are bounded to 5 MB, so
 * buffering gives S3 SigV4 a stable payload while keeping memory usage capped.
 * Avatar publication locks the user's DB row with a token that still names the
 * previous content hash, replaces the fixed user-ID object, then publishes the
 * new hash after storage succeeds. Pending locks cannot be taken over by uploads.
 */
export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	const t = event.locals.t;
	if (!user) return jsonError(t, 'common.unauthorized', 401);

	const isAvatar = event.request.headers.get('x-upload-type') === 'avatar';
	const maxSize = isAvatar ? MAX_AVATAR : MAX_ATTACHMENT;
	const declared = Number(event.request.headers.get('content-length') ?? 0);
	if (declared && declared > maxSize) return jsonError(t, 'upload.fileTooLarge', 400);
	if (!event.request.body) return jsonError(t, 'upload.noFile', 400);

	const cfg = resolveMediaStorageConfig({ ...env, ...(event.platform?.env ?? {}) });
	const configurationError = mediaStorageConfigurationError(cfg);
	if (configurationError) {
		console.error(`[media-storage] ${configurationError}`);
		return jsonError(t, 'upload.uploadFailed', 502);
	}

	let bytes: Uint8Array;
	try {
		bytes = await readUpload(event.request.body, maxSize);
	} catch (error) {
		if (error instanceof UploadTooLargeError) return jsonError(t, 'upload.fileTooLarge', 400);
		console.error('[Upload API Error - read]:', error);
		return jsonError(t, 'upload.uploadFailed', 502);
	}

	const mime = mimeForFormat(detectImageFormat(bytes.subarray(0, 12)));
	if (!mime) return jsonError(t, 'upload.invalidType', 400);

	const sha = bytesToHex(sha256(bytes));
	const db = event.locals.db;

	try {
		if (isAvatar) {
			const path = avatarStoragePath(user.id);
			const [previous] = await db
				.select({
					avatarFileId: users.avatarFileId,
					avatarContentType: users.avatarContentType
				})
				.from(users)
				.where(eq(users.id, user.id))
				.limit(1);
			if (!previous) throw new Error('avatar user not found');
			if (previous.avatarFileId && !isValidAvatarFileId(previous.avatarFileId)) {
				return jsonError(t, 'upload.uploadFailed', 409);
			}
			const publishedFileId = publicAvatarFileId(previous.avatarFileId);
			const pendingFileId = createAvatarUploadLock(publishedFileId);
			await publishMediaUpload(cfg, {
				path,
				bytes,
				contentType: mime,
				hasPreviousObject: previous.avatarFileId !== null,
				previousContentType: previous.avatarContentType,
				ownsLock: async () => {
					const [current] = await db
						.select({ fileId: users.avatarFileId })
						.from(users)
						.where(eq(users.id, user.id))
						.limit(1);
					return current?.fileId === pendingFileId;
				},
				dbWrite: async () => {
					const previousAvatarMatches = previous.avatarFileId
						? eq(users.avatarFileId, previous.avatarFileId)
						: isNull(users.avatarFileId);
					const prepared = await db
						.update(users)
						.set({ avatarFileId: pendingFileId })
						.where(and(eq(users.id, user.id), previousAvatarMatches))
						.returning({ id: users.id });
					if (prepared.length === 0) throw new Error('avatar changed during upload');
				},
				finalizeDbWrite: async () => {
					const finalized = await db
						.update(users)
						.set({ avatarFileId: sha, avatarContentType: mime })
						.where(and(eq(users.id, user.id), eq(users.avatarFileId, pendingFileId)))
						.returning({ id: users.id });
					if (finalized.length === 0) {
						const [current] = await db
							.select({ avatarFileId: users.avatarFileId })
							.from(users)
							.where(eq(users.id, user.id))
							.limit(1);
						if (current?.avatarFileId !== sha) {
							throw new Error('avatar publication token was lost');
						}
					}
				},
				rollbackDbWrite: async () => {
					const rolledBack = await db
						.update(users)
						.set({
							avatarFileId: publishedFileId,
							avatarContentType: previous.avatarContentType
						})
						.where(and(eq(users.id, user.id), eq(users.avatarFileId, pendingFileId)))
						.returning({ id: users.id });
					return rolledBack.length > 0;
				}
			});
			const avatarUrl = buildAvatarUrl(user.id, sha, mime);
			return json({ fileId: sha, url: `/avatar/${user.id}/${sha}`, avatarUrl });
		}

		const path = attachmentStoragePath(sha);
		let insertedSha: string | null = null;
		await publishMediaUpload(cfg, {
			path,
			bytes,
			contentType: mime,
			dbWrite: async () => {
				const inserted = await db
					.insert(attachments)
					.values({ fileId: sha, contentType: mime, uploaderId: user.id })
					.onConflictDoNothing()
					.returning({ fileId: attachments.fileId });
				if (inserted.length > 0) insertedSha = sha;
			},
			rollbackDbWrite: async () => {
				if (insertedSha !== null) {
					await db.delete(attachments).where(eq(attachments.fileId, insertedSha));
				}
			}
		});
		const ext = extFromMime(mime) ?? 'webp';
		return json({ fileId: sha, url: `/attachment/${sha}.${ext}` });
	} catch (error) {
		console.error('[Upload API Error - storage/db]:', error);
		return jsonError(t, 'upload.uploadFailed', 502);
	}
};
