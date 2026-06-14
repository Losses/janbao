import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { eq } from 'drizzle-orm';
import { attachments, users } from '$lib/server/db/schema';
import {
	resolvePcloudConfig,
	pcloudUploadStream,
	pcloudMove,
	pcloudDelete,
	pcloudMkcol,
	pcloudIsConfigured
} from '$lib/server/pcloud';
import { detectImageFormat, mimeForFormat, type ImageFormat } from '$lib/server/image';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const MAX_AVATAR = 1 * 1024 * 1024;
const MAX_ATTACHMENT = 5 * 1024 * 1024;

/**
 * Streaming image upload (raw request body, not multipart). The body is piped
 * through a TransformStream that counts bytes (aborts on size limit), sniffs the
 * real type from the first chunk (the client Content-Type is not trusted), and
 * hashes incrementally  - all while forwarding bytes straight to pCloud with no
 * full buffering. The file lands in /Janbao/tmp/<uuid> first, then MOVEs to its
 * final path once the sha/type are known (so a rejected upload never overwrites
 * an existing file). Avatars → /avatars/<userId>; attachments → /attachments/<sha>.
 */
export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	const t = event.locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}
	const db = event.locals.db;

	const isAvatar = event.request.headers.get('x-upload-type') === 'avatar';
	const maxSize = isAvatar ? MAX_AVATAR : MAX_ATTACHMENT;

	// Early size gate via Content-Length (rejects oversized uploads before streaming).
	const declared = Number(event.request.headers.get('content-length') ?? 0);
	if (declared && declared > maxSize) {
		return jsonError(t, 'upload.fileTooLarge', 400);
	}

	const cfg = resolvePcloudConfig({ ...env, ...(event.platform?.env ?? {}) });
	if (!pcloudIsConfigured(cfg)) {
		return jsonError(t, 'upload.uploadFailed', 502);
	}
	if (!event.request.body) {
		return jsonError(t, 'upload.noFile', 400);
	}

	const hasher = sha256.create();
	let seen = 0;
	let format: ImageFormat = 'other';
	let tooBig = false;
	const transform = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			seen += chunk.byteLength;
			if (seen > maxSize) {
				tooBig = true;
				controller.error(new Error('upload exceeds size limit'));
				return;
			}
			if (format === 'other' && seen <= chunk.byteLength) {
				format = detectImageFormat(chunk);
			}
			hasher.update(chunk);
			controller.enqueue(chunk);
		}
	});
	const piped = event.request.body.pipeThrough(transform);

	const tmpName = crypto.randomUUID();
	try {
		await pcloudMkcol(cfg, '/tmp');
		await pcloudUploadStream(cfg, '/tmp', tmpName, piped);
	} catch (err) {
		console.error('[Upload API Error - stream]:', err);
		await pcloudDelete(cfg, `/tmp/${tmpName}`).catch(() => {});
		if (tooBig) return jsonError(t, 'upload.fileTooLarge', 400);
		return jsonError(t, 'upload.uploadFailed', 502);
	}

	// Stream finished  - verify the real type (reject without touching the final file).
	const mime = mimeForFormat(format);
	if (!mime) {
		await pcloudDelete(cfg, `/tmp/${tmpName}`).catch(() => {});
		return jsonError(t, 'upload.invalidType', 400);
	}

	try {
		if (isAvatar) {
			await pcloudMove(cfg, `/tmp/${tmpName}`, `/avatars/${user.id}`);
			await db
				.update(users)
				.set({ avatarFileId: '1', avatarContentType: mime })
				.where(eq(users.id, user.id));
			return json({ fileId: '1', url: `/avatar/${user.id}` });
		}
		const sha = bytesToHex(hasher.digest());
		await pcloudMove(cfg, `/tmp/${tmpName}`, `/attachments/${sha}`);
		await db
			.insert(attachments)
			.values({ fileId: sha, contentType: mime, uploaderId: user.id })
			.onConflictDoNothing();
		return json({ fileId: sha, url: `/attachment/${sha}` });
	} catch (err) {
		console.error('[Upload API Error - move/db]:', err);
		await pcloudDelete(cfg, `/tmp/${tmpName}`).catch(() => {});
		return jsonError(t, 'upload.uploadFailed', 502);
	}
};
