import { describe, test, expect } from 'bun:test';
import { normalizeSearchSort } from './search-sort';

describe('normalizeSearchSort', () => {
	test('replies preserved on discussions', () => {
		expect(normalizeSearchSort('replies', 'discussions')).toBe('replies');
	});

	test('replies normalized to newest on every other scope', () => {
		expect(normalizeSearchSort('replies', 'activities')).toBe('newest');
		expect(normalizeSearchSort('replies', 'messages')).toBe('newest');
		expect(normalizeSearchSort('replies', 'users')).toBe('newest');
	});

	test('non-replies sorts pass through unchanged on every scope', () => {
		for (const scope of ['discussions', 'activities', 'messages', 'users'] as const) {
			expect(normalizeSearchSort('newest', scope)).toBe('newest');
			expect(normalizeSearchSort('oldest', scope)).toBe('oldest');
			expect(normalizeSearchSort('relevance', scope)).toBe('relevance');
		}
	});
});
