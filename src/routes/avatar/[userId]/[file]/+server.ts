import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { eq } from 'drizzle-orm';
import { users } from '$lib/server/db/schema';
import { isValidAvatarFileId, publicAvatarFileId } from '$lib/server/image';
import {
	avatarStoragePath,
	mediaResponse,
	mediaStorageConfigurationError,
	resolveMediaStorageConfig
} from '$lib/server/media-storage';

/**
 * Serve a user avatar from the configured media store. The
 * client requests `/avatar/<userId>/<avatarFileId>.<ext>` where avatarFileId is
 * the content sha and <ext> is derived client-side from users.avatarContentType:
 * the real extension lets CDN edge caches that key on file extensions
 * (Cloudflare's default set) cache it without a cache-everything rule, and the
 * sha makes a re-upload a new URL (guaranteed cache miss). The content-type is
 * read from users.avatarContentType (defaulting to image/webp), so the storage
 * body streams straight through with no buffering.
 */
export const GET: RequestHandler = async (event) => {
	const { userId: userIdParam, file } = event.params;
	const userId = Number(userIdParam);
	const requestedFileId = file.replace(/\.[a-z0-9]+$/i, '');
	const db = event.locals.db;
	const t = event.locals.t;

	if (!Number.isFinite(userId) || !isValidAvatarFileId(requestedFileId)) {
		return new Response(t.img.notFound, { status: 404 });
	}

	const cfg = resolveMediaStorageConfig({ ...env, ...(event.platform?.env ?? {}) });
	const configurationError = mediaStorageConfigurationError(cfg);
	if (configurationError) {
		console.error(`[media-storage] ${configurationError}`);
		return new Response(t.img.storageError, { status: 502 });
	}

	const rec = await db
		.select({ avatarFileId: users.avatarFileId, contentType: users.avatarContentType })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	const publishedFileId = publicAvatarFileId(rec[0]?.avatarFileId);
	if (rec.length === 0 || !publishedFileId || publishedFileId !== requestedFileId) {
		return new Response(t.img.notFound, { status: 404 });
	}

	try {
		return await mediaResponse(cfg, {
			path: avatarStoragePath(userId),
			contentType: rec[0].contentType || 'image/webp',
			cacheBust: publishedFileId,
			verifiedAvatarId: publishedFileId
		});
	} catch {
		return new Response(t.img.notFound, { status: 404 });
	}
};
