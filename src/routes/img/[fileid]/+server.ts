import type { RequestHandler } from './$types';
import { attachments } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import fs from 'node:fs/promises';
import path from 'node:path';

export const GET: RequestHandler = async (event) => {
	const { fileid } = event.params;
	const db = event.locals.db;

	// 1. Attachment Validation check
	const record = await db.select().from(attachments).where(eq(attachments.fileId, fileid)).limit(1);
	if (record.length === 0) {
		return new Response('Not Found', { status: 404 });
	}

	const pcloudToken = env.PCLOUD_TOKEN || event.platform?.env?.PCLOUD_TOKEN || '';

	let fileBody: BodyInit;
	let contentType = 'application/octet-stream';

	const uploadsDir = path.resolve('.local-uploads');
	const filePath = path.join(uploadsDir, fileid);

	let isMockFile = false;
	try {
		await fs.access(filePath);
		isMockFile = true;
	} catch {
		// File not accessible locally
	}

	if (!pcloudToken || isMockFile) {
		// Mock retrieval
		try {
			const data = await fs.readFile(filePath);
			fileBody = data;

			try {
				const metaContent = await fs.readFile(filePath + '.json', 'utf8');
				const meta = JSON.parse(metaContent) as { contentType?: string };
				if (meta.contentType) {
					contentType = meta.contentType;
				}
			} catch {
				// No metadata
			}
		} catch {
			return new Response('File not found in local storage', { status: 404 });
		}
	} else {
		// Real pCloud retrieval
		try {
			const linkRes = await fetch(
				`https://api.pcloud.com/getfilelink?auth=${pcloudToken}&fileid=${fileid}`
			);
			if (!linkRes.ok) {
				return new Response('Failed to get pCloud file link', { status: 502 });
			}
			const linkData = (await linkRes.json()) as {
				result: number;
				path: string;
				hosts: string[];
				error?: string;
			};

			if (linkData.result !== 0 || !linkData.hosts || linkData.hosts.length === 0) {
				return new Response(
					JSON.stringify({ error: linkData.error || 'Failed to get pCloud download link' }),
					{ status: 502 }
				);
			}

			const downloadUrl = `https://${linkData.hosts[0]}${linkData.path}`;
			const fileRes = await fetch(downloadUrl);

			if (!fileRes.ok) {
				return new Response('Failed to fetch file from pCloud storage', { status: 502 });
			}

			if (fileRes.body) {
				fileBody = fileRes.body;
			} else {
				fileBody = await fileRes.arrayBuffer();
			}
			contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
		} catch {
			return new Response('Error retrieving file from pCloud', { status: 500 });
		}
	}

	const allowedMimes = [
		'image/png',
		'image/jpeg',
		'image/webp',
		'image/gif',
		'image/avif',
		'image/bmp'
	];
	const isSafeImage = allowedMimes.includes(contentType);

	const headers = new Headers();
	headers.set('Content-Type', contentType);
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('Cache-Control', 'public, max-age=31536000');

	if (!isSafeImage) {
		headers.set('Content-Disposition', 'attachment; filename="file.bin"');
	} else {
		headers.set('Content-Disposition', 'inline');
	}

	return new Response(fileBody, {
		status: 200,
		headers
	});
};
