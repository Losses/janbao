import { describe, expect, test } from 'bun:test';
import {
	attachmentStoragePath,
	avatarStorageEntry,
	avatarStoragePath,
	mediaResponse,
	mediaStorageConfigurationError,
	resolveMediaStorageConfig
} from './media-storage';
import { isValidAvatarFileId, createAvatarUploadLock, publicAvatarFileId } from './image';

const avatarHash = 'a'.repeat(64);

describe('media storage selection', () => {
	test('defaults to pCloud for existing deployments', () => {
		const cfg = resolveMediaStorageConfig({
			PCLOUD_USERNAME: 'user',
			PCLOUD_PASSWORD: 'password'
		});
		expect(cfg.provider).toBe('pcloud');
		expect(mediaStorageConfigurationError(cfg)).toBeNull();
		expect(avatarStoragePath(7)).toBe('avatars/7');
		expect(avatarStorageEntry(7)).toBe('7');
	});

	test('keeps user-ID avatar filenames for S3 and rejects invalid identifiers', () => {
		const cfg = resolveMediaStorageConfig({
			MEDIA_STORAGE_PROVIDER: 's3',
			S3_ENDPOINT: 'https://s3.example.com',
			S3_BUCKET: 'media',
			S3_ACCESS_KEY_ID: 'key',
			S3_SECRET_ACCESS_KEY: 'secret',
			S3_REGION: 'us-east-1'
		});
		expect(cfg.provider).toBe('s3');
		expect(mediaStorageConfigurationError(cfg)).toBeNull();
		expect(avatarStoragePath(7)).toBe('avatars/7');
		expect(avatarStorageEntry(7)).toBe('7');
		expect(isValidAvatarFileId(avatarHash)).toBe(true);
		expect(isValidAvatarFileId('1')).toBe(true);
		expect(() => avatarStoragePath('../private')).toThrow('Invalid avatar user ID');
		for (const id of ['../../../private/backup.db', '..%2Fprivate', 'a/b', '', 'sha']) {
			expect(isValidAvatarFileId(id)).toBe(false);
		}
		expect(isValidAvatarFileId(null)).toBe(false);
		expect(isValidAvatarFileId(1)).toBe(false);
		expect(attachmentStoragePath('sha')).toBe('attachments/sha');
	});

	test('avatar upload locks hide the pending version', () => {
		const lock = createAvatarUploadLock(avatarHash);
		expect(isValidAvatarFileId(lock)).toBe(false);
		expect(publicAvatarFileId(lock)).toBeNull();
		expect(publicAvatarFileId(createAvatarUploadLock(null))).toBeNull();
		expect(publicAvatarFileId(`upload:${crypto.randomUUID()}`)).toBeNull();
	});

	test('rejects unknown providers', () => {
		const cfg = resolveMediaStorageConfig({ MEDIA_STORAGE_PROVIDER: 'disk' });
		expect(cfg.provider).toBe('invalid');
		expect(mediaStorageConfigurationError(cfg)).toContain('pcloud');
	});

	test('CDN redirects bust avatar cache with the content hash', async () => {
		const cfg = resolveMediaStorageConfig({
			MEDIA_STORAGE_PROVIDER: 's3',
			S3_ENDPOINT: 'https://s3.example.com',
			S3_BUCKET: 'media',
			S3_ACCESS_KEY_ID: 'key',
			S3_SECRET_ACCESS_KEY: 'secret',
			S3_REGION: 'us-east-1',
			S3_CDN_BASE_URL: 'https://cdn.example.com'
		});
		const response = await mediaResponse(cfg, {
			path: 'avatars/7',
			contentType: 'image/png',
			cacheBust: avatarHash
		});
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe(
			`https://cdn.example.com/avatars/7?v=${avatarHash}`
		);
	});
});

test('avatar reads reject changed bytes instead of caching them under an old hash', async () => {
	const original = globalThis.fetch;
	globalThis.fetch = (async (input) => {
		void input;
		return new Response(new Uint8Array([9]));
	}) as typeof fetch;
	try {
		const cfg = resolveMediaStorageConfig({ PCLOUD_USERNAME: 'test', PCLOUD_PASSWORD: 'test' });
		const response = await mediaResponse(cfg, {
			path: 'avatars/7',
			contentType: 'image/png',
			verifiedAvatarId: avatarHash
		});
		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toBe('no-store');
	} finally {
		globalThis.fetch = original;
	}
});
