import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { eq } from 'drizzle-orm';
import { attachments } from '$lib/server/db/schema';
import { resolvePcloudConfig, pcloudStream, pcloudIsConfigured } from '$lib/server/pcloud';

/**
 * Reverse-proxy a content attachment from pCloud. The content-type is read from
 * the attachments table (keyed by the pre-conversion sha256), so the pCloud
 * body streams straight through with no buffering or sniffing.
 */
export const GET: RequestHandler = async (event) => {
	const { fileId } = event.params;
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
		const body = await pcloudStream(cfg, `/attachments/${fileId}`);
		const headers = new Headers();
		headers.set('Content-Type', rec[0].contentType);
		headers.set('X-Content-Type-Options', 'nosniff');
		headers.set('Cache-Control', 'public, max-age=31536000, immutable');
		return new Response(body, { status: 200, headers });
	} catch {
		return new Response(t.img.notFound, { status: 404 });
	}
};
