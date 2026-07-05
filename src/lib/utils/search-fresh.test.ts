import { describe, test, expect } from 'bun:test';
import { isSearchEntryFresh } from './search-fresh';
import type { SearchCacheEntrySource } from './search-fresh';

describe('isSearchEntryFresh', () => {
	test('null entry is a miss', () => {
		expect(isSearchEntryFresh(null, 'foo', 'newest')).toBe(false);
	});

	test('matching query and sort is fresh', () => {
		const entry: SearchCacheEntrySource = { query: 'foo', sort: 'newest' };
		expect(isSearchEntryFresh(entry, 'foo', 'newest')).toBe(true);
	});

	test('query mismatch is a stale miss', () => {
		const entry: SearchCacheEntrySource = { query: 'foo', sort: 'newest' };
		expect(isSearchEntryFresh(entry, 'bar', 'newest')).toBe(false);
	});

	test('sort mismatch is a stale miss', () => {
		const entry: SearchCacheEntrySource = { query: 'foo', sort: 'newest' };
		expect(isSearchEntryFresh(entry, 'foo', 'relevance')).toBe(false);
	});

	test('a PageCacheSource with query field is fresh (round-trip)', () => {
		const source = { route: '/search', query: 'foo', sort: 'newest', page: 1 };
		expect(isSearchEntryFresh(source, 'foo', 'newest')).toBe(true);
	});

	test('a source without query is a stale miss', () => {
		const source = { route: '/search', sort: 'newest', page: 1 };
		expect(isSearchEntryFresh(source, 'foo', 'newest')).toBe(false);
	});
});
