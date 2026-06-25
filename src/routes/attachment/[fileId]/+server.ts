import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { eq } from 'drizzle-orm';
import { attachments } from '$lib/server/db/schema';
import {
	resolvePcloudConfig,
	pcloudStream,
	pcloudIsConfigured,
	forwardContentLength
} from '$lib/server/pcloud';

/**
 * Reverse-proxy a content attachment from pCloud. The URL may be
 * `/attachment/<sha>.<ext>` (the extension lets CDN edge caches key on it by
 * default); the cosmetic extension is stripped to recover the content sha. The
 * content-type is read from the attachments table (keyed by the pre-conversion
 * sha256), so the pCloud body streams straight through with no buffering.
 */
export const GET: RequestHandler = async (event) => {
	const { fileId: fileIdParam } = event.params;
	// Strip a trailing cosmetic extension (e.g. ".webp") to recover the sha that
	// keys both the DB row and the pCloud path (/attachments/<sha>). Legacy URLs
	// without an extension are unaffected: the sha is pure hex with no dot, so
	// the regex is a no-op on them.
	const fileId = fileIdParam.replace(/\.[a-z0-9]+$/i, '');
	const db = event.locals.db;
	const t = event.locals.t;

	const cfg = resolvePcloudConfig({ ...env, ...(event.platform?.env ?? {}) });
	if (!pcloudIsConfigured(cfg)) {
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
		const { body, headers: upstream } = await pcloudStream(cfg, `/attachments/${fileId}`);
		const headers = new Headers();
		headers.set('Content-Type', rec[0].contentType);
		headers.set('X-Content-Type-Options', 'nosniff');
		headers.set('Cache-Control', 'public, max-age=31536000, immutable');
		// fileId keys an immutable object (pre-conversion sha256), so the edge can
		// safely hold this for the full TTL without serving stale content.
		headers.set('CDN-Cache-Control', 'public, max-age=31536000');
		headers.set('ETag', `"${fileId}"`);
		forwardContentLength(headers, upstream);
		return new Response(body, { status: 200, headers });
	} catch {
		return new Response(t.img.notFound, { status: 404 });
	}
};
