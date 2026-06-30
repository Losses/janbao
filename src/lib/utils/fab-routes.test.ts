import { describe, test, expect } from 'bun:test';
import {
	isOverlayRoute,
	isComposeRoute,
	isDiscussionsListRoute,
	isMessagesListRoute,
	sourceListKindForOverlayOrCompose
} from './fab-routes';

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
