import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { eq } from 'drizzle-orm';
import { attachments, users } from '$lib/server/db/schema';
import { resolvePcloudConfig, pcloudUploadBytes, pcloudIsConfigured } from '$lib/server/pcloud';

const ALLOWED_MIMES = [
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif',
	'image/avif',
	'image/bmp'
];

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', buf);
	const view = new Uint8Array(digest);
	let hex = '';
	for (const byte of view) hex += byte.toString(16).padStart(2, '0');
	return hex;
}

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	const t = event.locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const db = event.locals.db;
	const formData = await event.request.formData();
	const file = formData.get('file');

	if (!file || !(file instanceof File)) {
		return jsonError(t, 'upload.noFile', 400);
	}

	const uploadType = formData.get('type') || event.url.searchParams.get('type') || 'discussion';
	const isAvatar = uploadType === 'avatar';
	const maxSize = isAvatar ? 1 * 1024 * 1024 : 5 * 1024 * 1024;

	if (file.size > maxSize) {
		return jsonError(t, 'upload.fileTooLarge', 400);
	}
	if (!ALLOWED_MIMES.includes(file.type)) {
		return jsonError(t, 'upload.invalidType', 400);
	}

	const cfg = resolvePcloudConfig({ ...env, ...(event.platform?.env ?? {}) });
	if (!pcloudIsConfigured(cfg)) {
		return jsonError(t, 'upload.uploadFailed', 502);
	}

	const buf = await file.arrayBuffer();
	const bytes = new Uint8Array(buf);
	try {
		if (isAvatar) {
			// Avatars are keyed by user id (overwrite-friendly). avatarFileId is a
			// truthy flag; avatarContentType lets /avatar stream without sniffing.
			await pcloudUploadBytes(cfg, '/avatars', String(user.id), bytes);
			await db
				.update(users)
				.set({ avatarFileId: '1', avatarContentType: file.type })
				.where(eq(users.id, user.id));
			return json({ fileId: '1', url: `/avatar/${user.id}` });
		}
		// Attachments are keyed by the pre-conversion sha256 of the bytes.
		const sha = await sha256Hex(buf);
		await pcloudUploadBytes(cfg, '/attachments', sha, bytes);
		await db
			.insert(attachments)
			.values({ fileId: sha, contentType: file.type, uploaderId: user.id })
			.onConflictDoNothing();
		return json({ fileId: sha, url: `/attachment/${sha}` });
	} catch {
		return jsonError(t, 'upload.uploadFailed', 502);
	}
};
