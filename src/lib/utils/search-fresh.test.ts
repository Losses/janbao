import { describe, test, expect } from 'bun:test';
import { isSearchEntryFresh } from './search-fresh';
import type { SearchCacheEntrySource } from './search-fresh';

describe('isSearchEntryFresh', () => {
	test('null entry is a miss', () => {
		expect(isSearchEntryFresh(null, 'foo', 'newest')).toBe(false);
	});

	test('matching q and sort is fresh', () => {
		const entry: SearchCacheEntrySource = { q: 'foo', sort: 'newest' };
		expect(isSearchEntryFresh(entry, 'foo', 'newest')).toBe(true);
	});

	test('q mismatch is a stale miss', () => {
		const entry: SearchCacheEntrySource = { q: 'foo', sort: 'newest' };
		expect(isSearchEntryFresh(entry, 'bar', 'newest')).toBe(false);
	});

	test('sort mismatch is a stale miss', () => {
		const entry: SearchCacheEntrySource = { q: 'foo', sort: 'newest' };
		expect(isSearchEntryFresh(entry, 'foo', 'relevance')).toBe(false);
	});
});
