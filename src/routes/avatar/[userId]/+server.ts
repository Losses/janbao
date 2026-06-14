import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { eq } from 'drizzle-orm';
import { users } from '$lib/server/db/schema';
import { resolvePcloudConfig, pcloudStream, pcloudIsConfigured } from '$lib/server/pcloud';

/**
 * Reverse-proxy a user avatar from pCloud (stored at /avatars/<userId>). The
 * content-type is read from users.avatarContentType (defaulting to image/webp),
 * so the pCloud body streams straight through with no buffering.
 */
export const GET: RequestHandler = async (event) => {
	const { userId: userIdParam } = event.params;
	const userId = Number(userIdParam);
	const db = event.locals.db;
	const t = event.locals.t;

	if (!Number.isFinite(userId)) {
		return new Response(t.img.notFound, { status: 404 });
	}

	const cfg = resolvePcloudConfig({ ...env, ...(event.platform?.env ?? {}) });
	if (!pcloudIsConfigured(cfg)) {
		return new Response(t.img.storageError, { status: 502 });
	}

	const rec = await db
		.select({ avatarFileId: users.avatarFileId, contentType: users.avatarContentType })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	// avatarFileId is a truthy "has avatar" flag set by the import/avatar upload.
	if (rec.length === 0 || !rec[0].avatarFileId) {
		return new Response(t.img.notFound, { status: 404 });
	}

	try {
		const body = await pcloudStream(cfg, `/avatars/${userIdParam}`);
		const headers = new Headers();
		headers.set('Content-Type', rec[0].contentType || 'image/webp');
		headers.set('X-Content-Type-Options', 'nosniff');
		headers.set('Cache-Control', 'public, max-age=31536000, immutable');
		return new Response(body, { status: 200, headers });
	} catch {
		return new Response(t.img.notFound, { status: 404 });
	}
};
