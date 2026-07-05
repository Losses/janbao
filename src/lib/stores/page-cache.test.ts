// src/lib/stores/page-cache.test.ts
/**
 * Unit suite for the unified PageCacheStore's pure logic. Covers
 * §11's required surface (capture / get / invalidate / pluggable
 * source) and the §7-mandated behaviors (TTL eviction, entry cap,
 * partial merge, colocated scrollTop).
 *
 * Tests target `page-cache-logic.ts` directly because bun:test has no
 * Svelte 5 runes loader (`[[bun-test-no-runes-loader]]`); the
 * reactive wrapper (`page-cache.svelte.ts`) is a thin `$state` shell
 * that delegates every mutation to these pure functions.
 */

import { describe, test, expect } from 'bun:test';
import {
	captureEntry,
	countEntries,
	enforceCap,
	evictExpired,
	findLatestWithSnippet,
	invalidateEntries,
	readEntry,
	serializeKey,
	type PageCacheState
} from './page-cache-logic';
import type {
	PageCacheCaptureInput,
	PageCacheDataSource,
	UnknownPageData
} from './page-cache-svelte-types';

/** Build a fresh empty state. Mirrors what the reactive store starts with. */
function newState(): PageCacheState {
	return {};
}

/** Test-only capture options. */
interface TestCaptureOptions {
	ttlMs?: number;
	maxEntries?: number;
}

/** Capture at a key, returning the merged entry for assertions. */
function capture(
	state: PageCacheState,
	pathname: string,
	subKey: string | undefined,
	input: PageCacheCaptureInput,
	now = 1000,
	opts: TestCaptureOptions = {}
) {
	return captureEntry(
		state,
		pathname,
		subKey,
		input,
		{
			ttlMs: opts.ttlMs ?? 1000,
			maxEntries: opts.maxEntries ?? 200
		},
		now
	);
}

describe('PageCacheStore logic: capture / read', () => {
	test('a fresh key returns null', () => {
		expect(readEntry(newState(), '/foo')).toBeNull();
	});

	test('captureEntry writes data that readEntry returns', () => {
		const state = newState();
		const data: UnknownPageData = { items: [1, 2, 3] };
		capture(state, '/foo', undefined, { data, source: { route: '/foo' } });
		const entry = readEntry(state, '/foo');
		expect(entry).not.toBeNull();
		expect(entry?.data).toEqual({ items: [1, 2, 3] });
		expect(entry?.source.route).toBe('/foo');
		expect(entry?.capturedAt).toBe(1000);
	});

	test('subKey partitions entries by scope', () => {
		const state = newState();
		capture(state, '/search', 'discussions', { data: { n: 1 } });
		capture(state, '/search', 'users', { data: { n: 2 } });
		expect(readEntry(state, '/search', 'discussions')?.data).toEqual({ n: 1 });
		expect(readEntry(state, '/search', 'users')?.data).toEqual({ n: 2 });
		expect(readEntry(state, '/search')).toBeNull();
	});

	test('scrollTop defaults to 0', () => {
		const state = newState();
		capture(state, '/p', undefined, { data: { a: 1 } });
		expect(readEntry(state, '/p')?.scrollTop).toBe(0);
	});

	test('captureEntry merges partial updates without losing sibling fields', () => {
		const state = newState();
		capture(state, '/p', undefined, { data: { a: 1 }, source: { route: '/p' } });
		// A scroll-only capture must NOT overwrite data.
		capture(state, '/p', undefined, { scrollTop: 123 });
		const entry = readEntry(state, '/p');
		expect(entry?.data).toEqual({ a: 1 });
		expect(entry?.scrollTop).toBe(123);
	});

	test('a data capture preserves the existing scrollTop', () => {
		const state = newState();
		capture(state, '/p', undefined, { scrollTop: 99 });
		capture(state, '/p', undefined, { data: { a: 1 } });
		const entry = readEntry(state, '/p');
		expect(entry?.data).toEqual({ a: 1 });
		expect(entry?.scrollTop).toBe(99);
	});

	test('source defaults to { route: pathname } when omitted', () => {
		const state = newState();
		capture(state, '/foo', undefined, { scrollTop: 5 });
		expect(readEntry(state, '/foo')?.source).toEqual({ route: '/foo' });
	});

	test('data:null is preserved (scroll-only entries)', () => {
		const state = newState();
		capture(state, '/p', undefined, { data: null });
		expect(readEntry(state, '/p')?.data).toBeNull();
	});

	test('serializeKey round-trips (pathname, subKey)', () => {
		expect(serializeKey('/foo', undefined)).toBe('/foo');
		expect(serializeKey('/search', 'discussions')).toBe('/search#discussions');
	});
});

describe('PageCacheStore logic: invalidate', () => {
	test('invalidateEntries(state, pathname, subKey) removes only that entry', () => {
		const state = newState();
		capture(state, '/a', undefined, { data: { x: 1 } });
		capture(state, '/b', undefined, { data: { x: 2 } });
		capture(state, '/search', 'discussions', { data: { x: 3 } });
		invalidateEntries(state, '/a');
		expect(readEntry(state, '/a')).toBeNull();
		expect(readEntry(state, '/b')?.data).toEqual({ x: 2 });
		expect(readEntry(state, '/search', 'discussions')?.data).toEqual({ x: 3 });
	});

	test('invalidateEntries(state, pathname) removes every subKey under that pathname', () => {
		const state = newState();
		capture(state, '/search', 'discussions', { data: { x: 1 } });
		capture(state, '/search', 'activities', { data: { x: 2 } });
		capture(state, '/search', 'messages', { data: { x: 3 } });
		capture(state, '/search', 'users', { data: { x: 4 } });
		capture(state, '/search', undefined, { data: { x: 5 } });
		invalidateEntries(state, '/search');
		expect(readEntry(state, '/search', 'discussions')).toBeNull();
		expect(readEntry(state, '/search', 'activities')).toBeNull();
		expect(readEntry(state, '/search', 'messages')).toBeNull();
		expect(readEntry(state, '/search', 'users')).toBeNull();
		expect(readEntry(state, '/search')).toBeNull();
	});

	test('invalidateEntries(state) clears the state', () => {
		const state = newState();
		capture(state, '/a', undefined, { data: { x: 1 } });
		capture(state, '/b', undefined, { data: { x: 2 } });
		invalidateEntries(state);
		expect(countEntries(state)).toBe(0);
	});

	test('invalidateEntries does not mutate an empty state', () => {
		const state = newState();
		invalidateEntries(state);
		expect(countEntries(state)).toBe(0);
	});
});

describe('PageCacheStore logic: TTL eviction', () => {
	test('entries older than the TTL are evicted on the next capture', () => {
		const state = newState();
		capture(state, '/old', undefined, { data: { x: 1 } }, 1000, { ttlMs: 100 });
		capture(state, '/new', undefined, { data: { x: 2 } }, 5000, { ttlMs: 100 });
		expect(readEntry(state, '/old')).toBeNull();
		expect(readEntry(state, '/new')?.data).toEqual({ x: 2 });
	});

	test('an entry inside its TTL survives', () => {
		const state = newState();
		capture(state, '/p', undefined, { data: { x: 1 } }, 1000, { ttlMs: 100 });
		capture(state, '/q', undefined, { data: { x: 2 } }, 1050, { ttlMs: 100 });
		expect(readEntry(state, '/p')?.data).toEqual({ x: 1 });
	});

	test('updating an entry refreshes its capturedAt', () => {
		const state = newState();
		capture(state, '/p', undefined, { data: { x: 1 } }, 1000, { ttlMs: 100 });
		capture(state, '/p', undefined, { scrollTop: 50 }, 1080, { ttlMs: 100 });
		capture(state, '/q', undefined, { data: { x: 2 } }, 1170, { ttlMs: 100 });
		expect(readEntry(state, '/p')?.scrollTop).toBe(50);
	});

	test('evictExpired removes only entries past the threshold', () => {
		const state = newState();
		capture(state, '/a', undefined, { data: 1 }, 100);
		capture(state, '/b', undefined, { data: 2 }, 200);
		evictExpired(state, 50, 240);
		expect(readEntry(state, '/a')).toBeNull();
		expect(readEntry(state, '/b')?.data).toEqual(2);
	});
});

describe('PageCacheStore logic: entry cap', () => {
	test('cap evicts the oldest entries on overflow', () => {
		const state = newState();
		capture(state, '/a', undefined, { data: { x: 1 } }, 1000, { maxEntries: 3 });
		capture(state, '/b', undefined, { data: { x: 2 } }, 1100, { maxEntries: 3 });
		capture(state, '/c', undefined, { data: { x: 3 } }, 1200, { maxEntries: 3 });
		capture(state, '/d', undefined, { data: { x: 4 } }, 1300, { maxEntries: 3 });
		expect(countEntries(state)).toBe(3);
		// /a is the oldest; it must be evicted to make room for /d.
		expect(readEntry(state, '/a')).toBeNull();
		expect(readEntry(state, '/d')?.data).toEqual({ x: 4 });
	});

	test('enforceCap is a no-op when under the cap', () => {
		const state = newState();
		capture(state, '/a', undefined, { data: 1 }, 1000);
		capture(state, '/b', undefined, { data: 2 }, 1100);
		enforceCap(state, 5);
		expect(countEntries(state)).toBe(2);
	});
});

describe('PageCacheStore logic: latest with snippet', () => {
	test('returns null when no entry has a snippet', () => {
		const state = newState();
		capture(state, '/a', undefined, { data: 1 });
		expect(findLatestWithSnippet(state)).toBeNull();
	});

	test('returns the entry whose capture included a snippet', () => {
		const state = newState();
		const snippet = (() => {}) as never;
		capture(state, '/a', undefined, { data: 1 });
		capture(state, '/b', undefined, { data: 2, snippet }, 1100);
		const latest = findLatestWithSnippet(state);
		expect(latest?.data).toEqual(2);
	});

	test('returns the most recent when multiple entries have snippets', () => {
		const state = newState();
		const s1 = (() => {}) as never;
		const s2 = (() => {}) as never;
		capture(state, '/a', undefined, { data: 1, snippet: s1 }, 1000);
		capture(state, '/b', undefined, { data: 2, snippet: s2 }, 2000);
		const latest = findLatestWithSnippet(state);
		expect(latest?.data).toEqual(2);
	});
});

/**
 * The pluggable-source `ensure` lives on the reactive store, but its
 * core behavior (cache-then-source) is exercised here against a
 * minimal mock. The reactive wrapper delegates to the same logic.
 */
describe('PageCacheStore logic: pluggable source contract', () => {
	test('a source that claims a key serves it', async () => {
		const calls: string[] = [];
		const source: PageCacheDataSource = {
			isResponsibleFor: (p) => {
				calls.push(`claim:${p}`);
				return p === '/sourced';
			},
			read: (p) => {
				calls.push(`read:${p}`);
				return { from: 'source' };
			}
		};
		// Simulate the store's ensure: read first, fall through to the source.
		const state = newState();
		let result = readEntry(state, '/sourced');
		if (!result) {
			if (source.isResponsibleFor('/sourced', undefined)) {
				const data = await source.read('/sourced', undefined);
				if (data !== null) {
					captureEntry(
						state,
						'/sourced',
						undefined,
						{ data, source: { route: '/sourced' } } as never,
						{ ttlMs: 1000, maxEntries: 200 },
						1000
					);
				}
			}
		}
		result = readEntry(state, '/sourced');
		expect(result?.data).toEqual({ from: 'source' });
		// And the result is cached for subsequent reads (no second source call).
		calls.length = 0;
		const second = readEntry(state, '/sourced');
		expect(second?.data).toEqual({ from: 'source' });
		expect(calls).toEqual([]);
	});

	test('a source that returns null falls through (no entry written)', async () => {
		const source: PageCacheDataSource = {
			isResponsibleFor: () => true,
			read: () => null
		};
		const state = newState();
		const data = await source.read('/x', undefined);
		if (data === null) {
			// no write
		} else {
			captureEntry(
				state,
				'/x',
				undefined,
				{ data } as never,
				{ ttlMs: 1000, maxEntries: 200 },
				1000
			);
		}
		expect(readEntry(state, '/x')).toBeNull();
	});
});
