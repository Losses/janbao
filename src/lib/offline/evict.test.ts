// Pure-function unit tests for the DV07 C05 read-TTL trim helper. The IDB
// half of expireReadReasons (the cascade-delete on empty reason set) is
// exercised via the integration audit (RV07-C05-*); this pins the pure
// decision of "drop 'read', keep the rest in canonical order".
import { test, expect } from 'bun:test';
import { withoutRead } from './evict';
import type { Reason } from './types';

test('withoutRead: read-only array => empty', () => {
	expect(withoutRead(['read'])).toEqual([]);
});

test('withoutRead: read + others => keeps others, drops read, canonical order', () => {
	// Input is out-of-order; output must follow REASON_ORDER.
	const input: Reason[] = ['read', 'bookmark', 'latest'];
	expect(withoutRead(input)).toEqual(['latest', 'bookmark']);
});

test('withoutRead: all curated + read together => read dropped', () => {
	const input: Reason[] = ['latest', 'mostViewed', 'mostReplied', 'read'];
	expect(withoutRead(input)).toEqual(['latest', 'mostViewed', 'mostReplied']);
});

test('withoutRead: no read present => unchanged (canonical order applied)', () => {
	const input: Reason[] = ['bookmark', 'front'];
	expect(withoutRead(input)).toEqual(['front', 'bookmark']);
});

test('withoutRead: empty array => empty', () => {
	expect(withoutRead([])).toEqual([]);
});

test('withoutRead: dedupes if read appears twice (defensive)', () => {
	const input: Reason[] = ['read', 'read', 'latest'];
	expect(withoutRead(input)).toEqual(['latest']);
});
