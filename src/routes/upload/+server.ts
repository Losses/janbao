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
import { buildAvatarUrl, extFromMime } from '$lib/utils/image';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { commitUploadedFile } from '$lib/server/utils/upload-commit';

const MAX_AVATAR = 1 * 1024 * 1024;
const MAX_ATTACHMENT = 5 * 1024 * 1024;

// Per-isolate flag: the /tmp upload folder is ensured once and reused.
let tmpEnsured = false;

/**
 * Streaming image upload (raw request body, not multipart). The body is piped
 * through a TransformStream that counts bytes (aborts on size limit), sniffs the
 * real type from the first chunk (the client Content-Type is not trusted), and
 * hashes incrementally - all while forwarding bytes straight to pCloud with no
 * full buffering. The file lands in /Janbao/tmp/<uuid> first, then MOVEs to its
 * final path once the sha/type are known (so a rejected upload never overwrites
 * an existing file). Avatars → /avatars/<userId>; attachments → /attachments/<sha>.
 *
 * The publish (DB write) and the MOVE are coordinated via commitUploadedFile
 * (DB-first, MOVE-second, with compensating rollback of the row on MOVE
 * failure). DB-first avoids the failure mode where a MOVE succeeds and the DB
 * write then throws, leaving storage and the DB out of sync; the compensation
 * always undoes our own DB write, never a content-addressed file that may be
 * referenced by a pre-existing row for the same sha.
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
	// Accumulate up to 12 bytes before type-sniffing: webp/avif magic needs all
	// 12, and a sub-12-byte first chunk would otherwise mis-detect as 'other'.
	const sniff = new Uint8Array(12);
	let sniffFill = 0;
	const transform = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			seen += chunk.byteLength;
			if (seen > maxSize) {
				tooBig = true;
				controller.error(new Error('upload exceeds size limit'));
				return;
			}
			if (format === 'other' && sniffFill < sniff.byteLength) {
				const take = Math.min(sniff.byteLength - sniffFill, chunk.byteLength);
				sniff.set(chunk.subarray(0, take), sniffFill);
				sniffFill += take;
				if (sniffFill >= sniff.byteLength) {
					format = detectImageFormat(sniff);
				}
			}
			hasher.update(chunk);
			controller.enqueue(chunk);
		}
	});
	const piped = event.request.body.pipeThrough(transform);

	const tmpName = crypto.randomUUID();
	try {
		// /tmp is created once and never removed; skip the WebDAV round-trip on
		// every subsequent upload in this isolate.
		if (!tmpEnsured) {
			await pcloudMkcol(cfg, '/tmp');
			tmpEnsured = true;
		}
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
		const sha = bytesToHex(hasher.digest());
		if (isAvatar) {
			// avatarFileId is the pure content sha; avatarUrl is built server-side
			// here and returned ready for the client to render (the client never
			// constructs avatar URLs itself). The URL extension is derived from the
			// freshly-detected MIME, so the type info is not coupled into the id.
			// Capture the prior avatar columns so the MOVE-failure rollback can
			// restore them; the prior file at /avatars/<userId> is untouched by a
			// failed MOVE, so restoring the columns also restores DB/file
			// consistency.
			const [prev] = await db
				.select({
					avatarFileId: users.avatarFileId,
					avatarContentType: users.avatarContentType
				})
				.from(users)
				.where(eq(users.id, user.id))
				.limit(1);
			await commitUploadedFile({
				dbWrite: async () => {
					await db
						.update(users)
						.set({ avatarFileId: sha, avatarContentType: mime })
						.where(eq(users.id, user.id));
				},
				move: () => pcloudMove(cfg, `/tmp/${tmpName}`, `/avatars/${user.id}`),
				rollbackDbWrite: async () => {
					await db
						.update(users)
						.set({
							avatarFileId: prev?.avatarFileId ?? null,
							avatarContentType: prev?.avatarContentType ?? null
						})
						.where(eq(users.id, user.id));
				}
			});
			const avatarUrl = buildAvatarUrl(user.id, sha, mime);
			return json({ fileId: sha, url: `/avatar/${user.id}/${sha}`, avatarUrl });
		}
		// Attachment URLs carry a real extension (baked into post content here) so
		// CDN edge caches treat them as static assets without a cache-everything
		// rule. The attachment route strips this cosmetic suffix to recover the sha.
		// Track whether THIS request actually inserted the row (vs an existing row
		// for the same sha from a prior or concurrent upload of identical bytes);
		// the rollback only deletes what we added, never a row another upload owns.
		let insertedSha: string | null = null;
		await commitUploadedFile({
			dbWrite: async () => {
				const inserted = await db
					.insert(attachments)
					.values({ fileId: sha, contentType: mime, uploaderId: user.id })
					.onConflictDoNothing()
					.returning({ fileId: attachments.fileId });
				if (inserted.length > 0) insertedSha = sha;
			},
			move: () => pcloudMove(cfg, `/tmp/${tmpName}`, `/attachments/${sha}`),
			rollbackDbWrite: async () => {
				if (insertedSha !== null) {
					await db.delete(attachments).where(eq(attachments.fileId, insertedSha));
				}
			}
		});
		const ext = extFromMime(mime) ?? 'webp';
		return json({ fileId: sha, url: `/attachment/${sha}.${ext}` });
	} catch (err) {
		console.error('[Upload API Error - move/db]:', err);
		// commitUploadedFile has already undone the DB write on a MOVE failure, so
		// no destination cleanup is needed here. The only leftover is the tmp file
		// (present whenever dbWrite threw before the MOVE consumed it); delete it
		// defensively. After a successful MOVE it is already gone and this is a
		// no-op.
		await pcloudDelete(cfg, `/tmp/${tmpName}`).catch(() => {});
		return jsonError(t, 'upload.uploadFailed', 502);
	}
};
