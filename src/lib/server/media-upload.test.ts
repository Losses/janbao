import { expect, test } from 'bun:test';
import { publishMediaUpload } from './media-upload';
import { mediaResponse, resolveMediaStorageConfig } from './media-storage';
import { s3ObjectUrl, type S3Config } from './s3';

const s3Env = {
	MEDIA_STORAGE_PROVIDER: 's3',
	S3_ENDPOINT: 'https://s3.example.com',
	S3_BUCKET: 'media',
	S3_ACCESS_KEY_ID: 'key',
	S3_SECRET_ACCESS_KEY: 'secret',
	S3_REGION: 'us-east-1'
};

test('committed lock with a lost DB response is rolled back for both providers', async () => {
	const original = globalThis.fetch;
	try {
		for (const cfg of [
			resolveMediaStorageConfig(s3Env),
			resolveMediaStorageConfig({ PCLOUD_USERNAME: 'test', PCLOUD_PASSWORD: 'test' })
		]) {
			let locked = false;
			let mutations = 0;
			globalThis.fetch = (async (input, init) => {
				const request = input instanceof Request ? input : new Request(input, init);
				if (request.method === 'MOVE' || request.headers.has('x-amz-copy-source')) mutations++;
				return new Response(null, { status: 204 });
			}) as typeof fetch;
			await expect(
				publishMediaUpload(cfg, {
					path: 'avatars/7',
					bytes: new Uint8Array([1]),
					contentType: 'image/png',
					dbWrite: async () => {
						locked = true;
						throw new Error('lost DB response');
					},
					ownsLock: async () => locked,
					rollbackDbWrite: async () => {
						locked = false;
					}
				})
			).rejects.toThrow('lost DB response');
			expect(locked).toBe(false);
			expect(mutations).toBe(0);
		}
	} finally {
		globalThis.fetch = original;
	}
});

test('pCloud restores a completed backup MOVE after its response is lost', async () => {
	const original = globalThis.fetch;
	const cfg = resolveMediaStorageConfig({ PCLOUD_USERNAME: 'test', PCLOUD_PASSWORD: 'test' });
	const objects = new Map<string, Uint8Array>([['/Janbao/avatars/7', new Uint8Array([1])]]);
	let locked = false;
	globalThis.fetch = (async (input, init) => {
		const request = input instanceof Request ? input : new Request(input, init);
		const path = new URL(request.url).pathname;
		if (request.method === 'PUT') objects.set(path, new Uint8Array(await request.arrayBuffer()));
		if (request.method === 'HEAD')
			return new Response(null, { status: objects.has(path) ? 200 : 404 });
		if (request.method === 'DELETE') objects.delete(path);
		if (request.method === 'MOVE') {
			const destination = new URL(request.headers.get('destination')!).pathname;
			objects.set(destination, objects.get(path)!);
			objects.delete(path);
			if (path === '/Janbao/avatars/7') throw new Error('lost MOVE response');
		}
		return new Response(null, { status: 204 });
	}) as typeof fetch;
	try {
		await expect(
			publishMediaUpload(cfg, {
				path: 'avatars/7',
				bytes: new Uint8Array([2]),
				contentType: 'image/png',
				hasPreviousObject: true,
				dbWrite: async () => {
					locked = true;
				},
				ownsLock: async () => locked,
				rollbackDbWrite: async () => {
					expect(objects.get('/Janbao/avatars/7')).toEqual(new Uint8Array([1]));
					locked = false;
				}
			})
		).rejects.toThrow('lost MOVE response');
		expect(locked).toBe(false);
		expect(objects.size).toBe(1);
	} finally {
		globalThis.fetch = original;
	}
});

test('a rejected concurrent publication cannot replace the active upload', async () => {
	const original = globalThis.fetch;
	const objects = installObjectStore();
	const cfg = resolveMediaStorageConfig(s3Env);
	const acquired = Promise.withResolvers<void>();
	const resume = Promise.withResolvers<void>();
	let locked = false;
	try {
		const first = publishMediaUpload(cfg, {
			path: 'avatars/7',
			bytes: new Uint8Array([1]),
			contentType: 'image/png',
			dbWrite: async () => {
				locked = true;
				acquired.resolve();
				await resume.promise;
			},
			finalizeDbWrite: async () => {
				locked = false;
			},
			rollbackDbWrite: async () => {
				locked = false;
			}
		});
		await acquired.promise;
		try {
			await expect(
				publishMediaUpload(cfg, {
					path: 'avatars/7',
					bytes: new Uint8Array([2]),
					contentType: 'image/png',
					dbWrite: async () => {
						if (locked) throw new Error('upload busy');
					},
					rollbackDbWrite: async () => {
						throw new Error('must not roll back another upload');
					}
				})
			).rejects.toThrow('upload busy');
		} finally {
			resume.resolve();
			await first;
		}
		expect(new Uint8Array(objects.get(s3ObjectUrl(s3Cfg(), 'avatars/7'))!)).toEqual(
			new Uint8Array([1])
		);
	} finally {
		globalThis.fetch = original;
	}
});

function s3Cfg(): S3Config {
	const cfg = resolveMediaStorageConfig(s3Env);
	if (cfg.provider !== 's3') throw new Error('expected s3');
	return cfg.s3;
}

function installObjectStore(): Map<string, ArrayBuffer> {
	const objects = new Map<string, ArrayBuffer>();
	globalThis.fetch = (async (input, init) => {
		const request = input instanceof Request ? input : new Request(input, init);
		if (request.method === 'DELETE') {
			objects.delete(request.url);
			return new Response(null, { status: 204 });
		}
		if (request.method === 'PUT') {
			const copySource = request.headers.get('x-amz-copy-source');
			if (copySource) {
				const sourcePath = decodeURIComponent(copySource);
				const sourceUrl = [...objects.keys()].find((url) => new URL(url).pathname === sourcePath);
				const source = sourceUrl ? objects.get(sourceUrl) : undefined;
				if (!source) return new Response('missing source', { status: 404 });
				objects.set(request.url, source);
				return new Response('<CopyObjectResult/>');
			}
			objects.set(request.url, await request.arrayBuffer());
			return new Response(null);
		}
		const body = objects.get(request.url);
		if (!body) return new Response(null, { status: 404 });
		return new Response(body);
	}) as typeof fetch;
	return objects;
}

test('failed pCloud PUT cleans the temporary path without publishing metadata', async () => {
	const original = globalThis.fetch;
	const methods: string[] = [];
	let writes = 0;
	globalThis.fetch = (async (_input, init) => {
		const method = init?.method ?? 'GET';
		methods.push(method);
		if (method === 'PUT') throw new Error('connection lost');
		return new Response(null, { status: 201 });
	}) as typeof fetch;
	try {
		await expect(
			publishMediaUpload(
				resolveMediaStorageConfig({ PCLOUD_USERNAME: 'test', PCLOUD_PASSWORD: 'test' }),
				{
					path: 'avatars/7',
					bytes: new Uint8Array([1]),
					contentType: 'image/png',
					dbWrite: async () => {
						writes++;
					},
					rollbackDbWrite: async () => {}
				}
			)
		).rejects.toThrow('connection lost');
		expect(methods).toEqual(['MKCOL', 'PUT', 'DELETE']);
		expect(writes).toBe(0);
	} finally {
		globalThis.fetch = original;
	}
});

test('two S3 avatar updates replace the same key and proxy the latest bytes', async () => {
	const original = globalThis.fetch;
	const cfg = resolveMediaStorageConfig(s3Env);
	const objects = installObjectStore();
	let writes = 0;
	try {
		for (const byte of [1, 2]) {
			await publishMediaUpload(cfg, {
				path: 'avatars/7',
				bytes: new Uint8Array([byte]),
				contentType: 'image/png',
				dbWrite: async () => {
					writes++;
				},
				rollbackDbWrite: async () => {}
			});
			const response = await mediaResponse(cfg, { path: 'avatars/7', contentType: 'image/png' });
			expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([byte]));
			expect(response.headers.get('content-type')).toBe('image/png');
		}
		expect(objects.size).toBe(1);
		expect(objects.has(s3ObjectUrl(s3Cfg(), 'avatars/7'))).toBe(true);
		expect(writes).toBe(2);
	} finally {
		globalThis.fetch = original;
	}
});

test('failed S3 avatar metadata write leaves the live object unchanged', async () => {
	const original = globalThis.fetch;
	const cfg = resolveMediaStorageConfig(s3Env);
	const objects = installObjectStore();
	try {
		await publishMediaUpload(cfg, {
			path: 'avatars/7',
			bytes: new Uint8Array([1]),
			contentType: 'image/png',
			dbWrite: async () => {},
			rollbackDbWrite: async () => {}
		});
		await expect(
			publishMediaUpload(cfg, {
				path: 'avatars/7',
				bytes: new Uint8Array([2]),
				contentType: 'image/png',
				dbWrite: async () => {
					throw new Error('db down');
				},
				rollbackDbWrite: async () => {}
			})
		).rejects.toThrow('db down');
		const live = objects.get(s3ObjectUrl(s3Cfg(), 'avatars/7'));
		expect(live).toBeDefined();
		expect(new Uint8Array(live ?? new ArrayBuffer(0))).toEqual(new Uint8Array([1]));
		expect([...objects.keys()].some((url) => url.includes('/tmp/'))).toBe(false);
	} finally {
		globalThis.fetch = original;
	}
});

test('S3 avatar publication finalizes metadata after copying and retries transient failures', async () => {
	const original = globalThis.fetch;
	const cfg = resolveMediaStorageConfig(s3Env);
	const events: string[] = [];
	let finalizeAttempts = 0;
	globalThis.fetch = (async (input, init) => {
		const request = input instanceof Request ? input : new Request(input, init);
		if (request.method === 'PUT' && request.headers.has('x-amz-copy-source')) {
			events.push('copy');
			return new Response('<CopyObjectResult/>');
		}
		return new Response(null, { status: request.method === 'DELETE' ? 204 : 200 });
	}) as typeof fetch;
	try {
		await publishMediaUpload(cfg, {
			path: 'avatars/7',
			bytes: new Uint8Array([1]),
			contentType: 'image/png',
			dbWrite: async () => {
				events.push('prepare');
			},
			finalizeDbWrite: async () => {
				finalizeAttempts++;
				events.push(`finalize-${finalizeAttempts}`);
				if (finalizeAttempts < 3) throw new Error('db temporarily unavailable');
			},
			rollbackDbWrite: async () => {
				events.push('rollback');
			}
		});
		expect(events).toEqual(['prepare', 'copy', 'finalize-1', 'finalize-2', 'finalize-3']);
	} finally {
		globalThis.fetch = original;
	}
});

test('failed S3 avatar finalization restores the previous object and metadata', async () => {
	const original = globalThis.fetch;
	const cfg = resolveMediaStorageConfig(s3Env);
	const objects = installObjectStore();
	let rollbacks = 0;
	try {
		await publishMediaUpload(cfg, {
			path: 'avatars/7',
			bytes: new Uint8Array([1]),
			contentType: 'image/png',
			dbWrite: async () => {},
			rollbackDbWrite: async () => {}
		});
		await expect(
			publishMediaUpload(cfg, {
				path: 'avatars/7',
				bytes: new Uint8Array([2]),
				contentType: 'image/webp',
				hasPreviousObject: true,
				previousContentType: 'image/png',
				dbWrite: async () => {},
				finalizeDbWrite: async () => {
					throw new Error('db unavailable');
				},
				rollbackDbWrite: async () => {
					const restored = objects.get(s3ObjectUrl(s3Cfg(), 'avatars/7'));
					expect(new Uint8Array(restored ?? new ArrayBuffer(0))).toEqual(new Uint8Array([1]));
					rollbacks++;
				}
			})
		).rejects.toThrow('db unavailable');
		const live = objects.get(s3ObjectUrl(s3Cfg(), 'avatars/7'));
		expect(new Uint8Array(live ?? new ArrayBuffer(0))).toEqual(new Uint8Array([1]));
		expect(rollbacks).toBe(1);
		expect(objects.size).toBe(1);
	} finally {
		globalThis.fetch = original;
	}
});

test('missing previous S3 avatar still publishes the new object', async () => {
	const original = globalThis.fetch;
	const cfg = resolveMediaStorageConfig(s3Env);
	const objects = installObjectStore();
	try {
		await publishMediaUpload(cfg, {
			path: 'avatars/7',
			bytes: new Uint8Array([9]),
			contentType: 'image/png',
			hasPreviousObject: true,
			previousContentType: 'image/webp',
			dbWrite: async () => {},
			rollbackDbWrite: async () => {}
		});
		const live = objects.get(s3ObjectUrl(s3Cfg(), 'avatars/7'));
		expect(new Uint8Array(live ?? new ArrayBuffer(0))).toEqual(new Uint8Array([9]));
		expect([...objects.keys()].some((url) => url.includes('/tmp/'))).toBe(false);
	} finally {
		globalThis.fetch = original;
	}
});

test('lost S3 avatar ownership preserves the recovery backup without overwriting storage', async () => {
	const original = globalThis.fetch;
	const cfg = resolveMediaStorageConfig(s3Env);
	const objects = installObjectStore();
	try {
		await publishMediaUpload(cfg, {
			path: 'avatars/7',
			bytes: new Uint8Array([1]),
			contentType: 'image/png',
			dbWrite: async () => {},
			rollbackDbWrite: async () => {}
		});
		await expect(
			publishMediaUpload(cfg, {
				path: 'avatars/7',
				bytes: new Uint8Array([2]),
				contentType: 'image/webp',
				hasPreviousObject: true,
				previousContentType: 'image/png',
				dbWrite: async () => {},
				finalizeDbWrite: async () => {
					throw new Error('token stolen');
				},
				ownsLock: async () => false,
				rollbackDbWrite: async () => false
			})
		).rejects.toThrow('token stolen');
		const live = objects.get(s3ObjectUrl(s3Cfg(), 'avatars/7'));
		expect(new Uint8Array(live ?? new ArrayBuffer(0))).toEqual(new Uint8Array([2]));
	} finally {
		globalThis.fetch = original;
	}
});
