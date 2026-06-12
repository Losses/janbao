import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import type { RequestHandler } from './$types';
import { attachments } from '$lib/server/db/schema';
import { env } from '$env/dynamic/private';
import fs from 'node:fs/promises';
import path from 'node:path';

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

	const allowedMimes = [
		'image/png',
		'image/jpeg',
		'image/webp',
		'image/gif',
		'image/avif',
		'image/bmp'
	];
	if (!allowedMimes.includes(file.type)) {
		return jsonError(t, 'upload.invalidType', 400);
	}

	// Read credentials
	const pcloudToken = env.PCLOUD_TOKEN || event.platform?.env?.PCLOUD_TOKEN || '';
	const pcloudFolderId = env.PCLOUD_FOLDER_ID || event.platform?.env?.PCLOUD_FOLDER_ID || '';

	let fileId: string;

	if (!pcloudToken || !pcloudFolderId) {
		// Mock Mode
		fileId = crypto.randomUUID();
		const uploadsDir = path.resolve('.local-uploads');
		await fs.mkdir(uploadsDir, { recursive: true });
		const filePath = path.join(uploadsDir, fileId);

		await fs.writeFile(filePath, Buffer.from(await file.arrayBuffer()));
		await fs.writeFile(filePath + '.json', JSON.stringify({ contentType: file.type }));
	} else {
		// Real pCloud Mode
		const pcloudUrl = `https://api.pcloud.com/uploadfile?auth=${pcloudToken}&folderid=${pcloudFolderId}`;
		const pcloudFormData = new FormData();
		pcloudFormData.append('file', file, file.name);

		const pcloudRes = await fetch(pcloudUrl, {
			method: 'POST',
			body: pcloudFormData
		});

		if (!pcloudRes.ok) {
			return jsonError(t, 'upload.uploadFailed', 502);
		}

		const pcloudData = (await pcloudRes.json()) as {
			result: number;
			fileids?: number[];
			error?: string;
		};

		if (pcloudData.result !== 0 || !pcloudData.fileids || pcloudData.fileids.length === 0) {
			return jsonError(t, 'upload.uploadFailed', 502);
		}

		fileId = String(pcloudData.fileids[0]);
	}

	// Log in attachments table
	await db.insert(attachments).values({
		fileId: fileId,
		uploaderId: user.id,
		createdAt: new Date()
	});

	const protocol = event.url.protocol;
	const host = event.url.host;
	const imageUrl = `${protocol}//${host}/img/${fileId}`;

	return json({
		fileId,
		url: imageUrl
	});
};
