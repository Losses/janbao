import { describe, test, expect } from 'bun:test';
import { resolveHeaderMode } from './header-mode';

describe('resolveHeaderMode', () => {
	test('root for primary tab routes', () => {
		expect(resolveHeaderMode('/')).toBe('root');
		expect(resolveHeaderMode('/activity')).toBe('root');
		expect(resolveHeaderMode('/messages/inbox')).toBe('root');
		expect(resolveHeaderMode('/discussion/123/slug')).toBe('root');
		expect(resolveHeaderMode('/discussions/p2')).toBe('root');
	});

	test('search for /search', () => {
		expect(resolveHeaderMode('/search')).toBe('search');
	});

	test('deep for other no-tab routes', () => {
		expect(resolveHeaderMode('/bookmarks')).toBe('deep');
		expect(resolveHeaderMode('/profile/42/name')).toBe('deep');
		expect(resolveHeaderMode('/notifications')).toBe('deep');
		expect(resolveHeaderMode('/admin')).toBe('deep');
	});
});
