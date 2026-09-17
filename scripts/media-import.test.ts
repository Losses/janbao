import { expect, mock, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { resolveMediaStorageConfig } from '../src/lib/server/media-storage';

mock.module('./import-shared', () => ({
	convertToWebp: () => new Uint8Array([1, 2, 3])
}));

const { importAvatar } = await import('./media-import');

const s3Cfg = resolveMediaStorageConfig({
	MEDIA_STORAGE_PROVIDER: 's3',
	S3_ENDPOINT: 'https://s3.example.com',
	S3_BUCKET: 'media',
	S3_ACCESS_KEY_ID: 'key',
	S3_SECRET_ACCESS_KEY: 'secret',
	S3_REGION: 'us-east-1'
});

test('importAvatar skips PUT when the user-ID object already exists', async () => {
	const original = globalThis.fetch;
	let puts = 0;
	globalThis.fetch = (async (input, init) => {
		const request = input instanceof Request ? input : new Request(input, init);
		if (request.method === 'PUT') puts++;
		return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
	}) as typeof fetch;
	try {
		const existing = new Set(['7']);
		const result = await importAvatar(s3Cfg, 7, 'unused.webp', existing);
		expect(result.fileId).toBe(
			createHash('sha256')
				.update(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
				.digest('hex')
		);
		expect(result.contentType).toBe('image/png');
		expect(puts).toBe(0);
		expect(existing.has('7')).toBe(true);
	} finally {
		globalThis.fetch = original;
	}
});

test('importAvatar uploads missing user-ID objects', async () => {
	const original = globalThis.fetch;
	let puts = 0;
	globalThis.fetch = (async (input) => {
		void input;
		puts++;
		return new Response(null, { status: 200 });
	}) as typeof fetch;
	try {
		const existing = new Set<string>();
		await importAvatar(s3Cfg, 7, 'unused.webp', existing);
		expect(puts).toBe(1);
		expect(existing.has('7')).toBe(true);
	} finally {
		globalThis.fetch = original;
	}
});
