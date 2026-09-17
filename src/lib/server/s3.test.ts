import { describe, expect, test } from 'bun:test';
import {
	resolveS3Config,
	s3CacheControlForPath,
	s3CopyObject,
	s3ConfigurationError,
	s3ListFolder,
	s3PutBytes,
	s3ObjectKey,
	s3ObjectUrl,
	s3PublicUrl,
	type S3Config
} from './s3';

function baseConfig(overrides: Partial<S3Config> = {}): S3Config {
	return {
		endpoint: 'https://s3.us-east-1.amazonaws.com',
		bucket: 'example-bucket',
		accessKeyId: 'key',
		secretAccessKey: 'secret',
		region: 'us-east-1',
		sessionToken: '',
		forcePathStyle: true,
		prefix: 'Janbao',
		cdnBaseUrl: 'https://cdn.example.com',
		...overrides
	};
}

describe('S3 configuration', () => {
	test('uses standard environment names and defaults to path style', () => {
		const cfg = resolveS3Config({
			S3_ENDPOINT: 'https://s3.example.com/',
			S3_BUCKET: 'media',
			S3_ACCESS_KEY_ID: 'key',
			S3_SECRET_ACCESS_KEY: 'secret',
			S3_REGION: 'us-east-1',
			S3_PREFIX: '/forum/'
		});
		expect(cfg.endpoint).toBe('https://s3.example.com');
		expect(cfg.prefix).toBe('forum');
		expect(cfg.forcePathStyle).toBe(true);
		expect(s3ConfigurationError(cfg)).toBeNull();
	});

	test('reports the first missing required setting', () => {
		expect(s3ConfigurationError(baseConfig({ region: '' }))).toBe('S3_REGION is required');
	});
});

describe('S3 object URLs', () => {
	test('builds path-style URLs with an encoded prefix and key', () => {
		const cfg = baseConfig();
		expect(s3ObjectKey(cfg, '/attachments/a b')).toBe('Janbao/attachments/a b');
		expect(s3ObjectUrl(cfg, '/attachments/a b')).toBe(
			'https://s3.us-east-1.amazonaws.com/example-bucket/Janbao/attachments/a%20b'
		);
		expect(s3PublicUrl(cfg, '/attachments/a b')).toBe(
			'https://cdn.example.com/Janbao/attachments/a%20b'
		);
		expect(s3PublicUrl(cfg, 'avatars/7', 'abc')).toBe(
			'https://cdn.example.com/Janbao/avatars/7?v=abc'
		);
	});

	test('builds virtual-hosted-style URLs', () => {
		const cfg = baseConfig({
			endpoint: 'https://s3.us-east-1.amazonaws.com',
			bucket: 'media',
			forcePathStyle: false,
			prefix: ''
		});
		expect(s3ObjectUrl(cfg, 'avatars/1/hash')).toBe(
			'https://media.s3.us-east-1.amazonaws.com/avatars/1/hash'
		);
	});
});

describe('S3 object cache headers', () => {
	test('avatar replacements revalidate while attachments remain immutable', async () => {
		const originalFetch = globalThis.fetch;
		const policies: string[] = [];
		globalThis.fetch = (async (input, init) => {
			const request = input instanceof Request ? input : new Request(input, init);
			policies.push(request.headers.get('cache-control') ?? '');
			return new Response(null, { status: 200 });
		}) as typeof fetch;
		try {
			expect(s3CacheControlForPath('avatars/7')).toBe('no-cache, max-age=0, must-revalidate');
			await s3PutBytes(baseConfig(), 'avatars/7', new Uint8Array([1]), 'image/png');
			await s3PutBytes(baseConfig(), 'attachments/hash', new Uint8Array([1]), 'image/png');
			expect(policies).toEqual([
				'no-cache, max-age=0, must-revalidate',
				'public, max-age=31536000, immutable'
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

describe('S3 object copy', () => {
	test('rejects an embedded S3 error returned with HTTP 200', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input) => {
			void input;
			return new Response('<Error><Code>InternalError</Code></Error>', { status: 200 });
		}) as typeof fetch;
		try {
			await expect(
				s3CopyObject(baseConfig(), 'tmp/source', 'avatars/7', 'image/webp')
			).rejects.toThrow('invalid response');
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

describe('S3 object listing', () => {
	test('follows continuation tokens and keeps nested relative keys', async () => {
		const originalFetch = globalThis.fetch;
		const requested: string[] = [];
		globalThis.fetch = (async (input) => {
			const url = input instanceof Request ? input.url : input.toString();
			requested.push(url);
			if (requested.length === 1) {
				return new Response(
					'<ListBucketResult><Contents><Key>Janbao/avatars/1/one</Key></Contents>' +
						'<NextContinuationToken>A&amp;B</NextContinuationToken></ListBucketResult>'
				);
			}
			return new Response(
				'<ListBucketResult><Contents><Key>Janbao/avatars/2/two</Key></Contents></ListBucketResult>'
			);
		}) as typeof fetch;
		try {
			const names = await s3ListFolder(baseConfig(), 'avatars');
			expect(names).toEqual(new Set(['1/one', '2/two']));
			expect(new URL(requested[0]).searchParams.get('prefix')).toBe('Janbao/avatars/');
			expect(new URL(requested[1]).searchParams.get('continuation-token')).toBe('A&B');
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('reads namespaced list XML', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input) => {
			void input;
			return new Response(
				'<ns:ListBucketResult xmlns:ns="http://s3.amazonaws.com/doc/2006-03-01/">' +
					'<ns:Contents><ns:Key>Janbao/avatars/7</ns:Key></ns:Contents>' +
					'</ns:ListBucketResult>'
			);
		}) as typeof fetch;
		try {
			expect(await s3ListFolder(baseConfig(), 'avatars')).toEqual(new Set(['7']));
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
