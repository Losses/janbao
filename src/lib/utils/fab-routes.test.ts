import { describe, test, expect } from 'bun:test';
import {
	isOverlayRoute,
	isComposeRoute,
	isDiscussionsListRoute,
	isMessagesListRoute,
	sourceListKindForOverlayOrCompose,
	getRouteFabRule,
	backTargetListKind
} from './route-config';

describe('isOverlayRoute', () => {
	test('thread routes', () => {
		expect(isOverlayRoute('/discussion/123')).toBe(true);
		expect(isOverlayRoute('/discussion/123/some-slug')).toBe(true);
		expect(isOverlayRoute('/discussion/123/slug/p1')).toBe(true);
	});

	test('conversation routes (numeric id only)', () => {
		expect(isOverlayRoute('/messages/123')).toBe(true);
		expect(isOverlayRoute('/messages/123/p2')).toBe(true);
	});

	test('messages/new and messages/inbox are NOT overlay routes', () => {
		// /messages/new is a compose route, /messages/inbox is the list; neither
		// matches /messages/<digits>.
		expect(isOverlayRoute('/messages/new')).toBe(false);
		expect(isOverlayRoute('/messages/inbox')).toBe(false);
	});

	test('tab roots and other routes', () => {
		expect(isOverlayRoute('/')).toBe(false);
		expect(isOverlayRoute('/activity')).toBe(false);
		expect(isOverlayRoute('/profile/42')).toBe(false);
		expect(isOverlayRoute('/bookmarks')).toBe(false);
		expect(isOverlayRoute('/search')).toBe(false);
	});
});

describe('isComposeRoute', () => {
	test('the two compose routes', () => {
		expect(isComposeRoute('/post/discussion')).toBe(true);
		expect(isComposeRoute('/messages/new')).toBe(true);
	});

	test('non-compose routes', () => {
		expect(isComposeRoute('/')).toBe(false);
		expect(isComposeRoute('/post/discussion/123')).toBe(false);
		expect(isComposeRoute('/messages/inbox')).toBe(false);
		expect(isComposeRoute('/messages/123')).toBe(false);
	});
});

describe('isDiscussionsListRoute', () => {
	test('only the discussions tab root', () => {
		expect(isDiscussionsListRoute('/')).toBe(true);
		expect(isDiscussionsListRoute('/discussions/p2')).toBe(false);
		expect(isDiscussionsListRoute('/discussion/123')).toBe(false);
		expect(isDiscussionsListRoute('/activity')).toBe(false);
	});
});

describe('isMessagesListRoute', () => {
	test('only the messages inbox', () => {
		expect(isMessagesListRoute('/messages/inbox')).toBe(true);
		expect(isMessagesListRoute('/messages/123')).toBe(false);
		expect(isMessagesListRoute('/messages/new')).toBe(false);
		expect(isMessagesListRoute('/')).toBe(false);
	});
});

describe('sourceListKindForOverlayOrCompose', () => {
	test('discussions thread and discussion compose route', () => {
		expect(sourceListKindForOverlayOrCompose('/discussion/123')).toBe('discussions');
		expect(sourceListKindForOverlayOrCompose('/discussion/123/slug/p1')).toBe('discussions');
		expect(sourceListKindForOverlayOrCompose('/post/discussion')).toBe('discussions');
	});

	test('messages conversation and messages compose route', () => {
		expect(sourceListKindForOverlayOrCompose('/messages/123')).toBe('messages');
		expect(sourceListKindForOverlayOrCompose('/messages/123/p2')).toBe('messages');
		expect(sourceListKindForOverlayOrCompose('/messages/new')).toBe('messages');
	});

	test('list routes and unrelated routes resolve to null', () => {
		expect(sourceListKindForOverlayOrCompose('/')).toBeNull();
		expect(sourceListKindForOverlayOrCompose('/messages/inbox')).toBeNull();
		expect(sourceListKindForOverlayOrCompose('/activity')).toBeNull();
		expect(sourceListKindForOverlayOrCompose('/messages/inbox/extra')).toBeNull();
	});
});

// Non-FAB GesturePageLayout routes carry fab: { family: 'overlay', kind: 'deep' }
// so the FAB atom stays mounted and the overlay sampler drives its scale across
// the list<->deep boundary. The kind resolves at runtime from the back target,
// not statically, so sourceListKindForOverlayOrCompose returns null for them.
describe('deep (non-FAB GesturePageLayout) routes', () => {
	test('carry fab.family overlay and fab.kind deep', () => {
		const deep = [
			'/bookmarks',
			'/search',
			'/notifications',
			'/profile',
			'/profile/settings',
			'/profile/42/foo',
			'/profile/comments/42/foo',
			'/profile/discussions/42/foo',
			'/profile/invitations',
			'/profile/edit',
			'/profile/password',
			'/profile/preferences',
			'/admin',
			'/admin/backups',
			'/admin/categories',
			'/admin/permissions'
		];
		for (const path of deep) {
			const rule = getRouteFabRule(path);
			expect(rule, `${path} must match a fab rule`).not.toBeNull();
			expect(rule?.fab?.family, `${path} family must be overlay`).toBe('overlay');
			expect(rule?.fab?.kind, `${path} kind must be deep`).toBe('deep');
		}
	});

	test('are not classified as overlay threads/conversations', () => {
		expect(isOverlayRoute('/bookmarks')).toBe(false);
		expect(isOverlayRoute('/profile/42/foo')).toBe(false);
		expect(isOverlayRoute('/search')).toBe(false);
		expect(isOverlayRoute('/admin/backups')).toBe(false);
	});

	test('resolve sourceListKindForOverlayOrCompose to null (kind is runtime-resolved)', () => {
		expect(sourceListKindForOverlayOrCompose('/bookmarks')).toBeNull();
		expect(sourceListKindForOverlayOrCompose('/profile/edit')).toBeNull();
		expect(sourceListKindForOverlayOrCompose('/search')).toBeNull();
	});
});

describe('backTargetListKind', () => {
	test('discussions list back target', () => {
		expect(backTargetListKind('/')).toBe('discussions');
		expect(backTargetListKind('/?foo=bar')).toBe('discussions');
	});

	test('messages inbox back target, with or without search', () => {
		expect(backTargetListKind('/messages/inbox')).toBe('messages');
		expect(backTargetListKind('/messages/inbox?page=2')).toBe('messages');
		expect(backTargetListKind('/messages/inbox?filter=unread')).toBe('messages');
	});

	test('non-list back targets default to discussions', () => {
		expect(backTargetListKind('/profile/edit')).toBe('discussions');
		expect(backTargetListKind(null)).toBe('discussions');
	});
});
