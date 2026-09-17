import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { eq } from 'drizzle-orm';
import { attachments } from '$lib/server/db/schema';
import {
	attachmentStoragePath,
	mediaResponse,
	mediaStorageConfigurationError,
	resolveMediaStorageConfig
} from '$lib/server/media-storage';

/**
 * Serve a content attachment from the configured media store. The URL may be
 * `/attachment/<sha>.<ext>` (the extension lets CDN edge caches key on it by
 * default); the cosmetic extension is stripped to recover the content sha. The
 * content-type is read from the attachments table (keyed by the pre-conversion
 * sha256). The response either redirects to the CDN or streams storage bytes.
 */
export const GET: RequestHandler = async (event) => {
	const { fileId: fileIdParam } = event.params;
	// Strip a trailing cosmetic extension (e.g. ".webp") to recover the sha that
	// keys both the DB row and the storage path (attachments/<sha>). Legacy URLs
	// without an extension are unaffected: the sha is pure hex with no dot, so
	// the regex is a no-op on them.
	const fileId = fileIdParam.replace(/\.[a-z0-9]+$/i, '');
	const db = event.locals.db;
	const t = event.locals.t;

	const cfg = resolveMediaStorageConfig({ ...env, ...(event.platform?.env ?? {}) });
	const configurationError = mediaStorageConfigurationError(cfg);
	if (configurationError) {
		console.error(`[media-storage] ${configurationError}`);
		return new Response(t.img.storageError, { status: 502 });
	}

	const rec = await db
		.select({ contentType: attachments.contentType })
		.from(attachments)
		.where(eq(attachments.fileId, fileId))
		.limit(1);
	if (rec.length === 0) {
		return new Response(t.img.notFound, { status: 404 });
	}

	try {
		return await mediaResponse(cfg, {
			path: attachmentStoragePath(fileId),
			contentType: rec[0].contentType,
			etag: `"${fileId}"`,
			cacheBust: fileId
		});
	} catch {
		return new Response(t.img.notFound, { status: 404 });
	}
};
