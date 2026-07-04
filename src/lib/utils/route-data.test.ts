import { describe, test, expect } from 'bun:test';
import { getRouteData, getRouteTag } from './route-data';
import type { RouteData, RouteTag } from './route-data';

describe('getRouteData - tag assignments per §3 + §14.1 + Cycle 1 spec', () => {
	interface TagCase {
		readonly path: string;
		readonly tag: RouteTag;
	}
	const cases: readonly TagCase[] = [
		// 'tab': the three pager roots + tab-internal pagination + offline tab mirrors.
		{ path: '/', tag: 'tab' },
		{ path: '/activity', tag: 'tab' },
		{ path: '/messages/inbox', tag: 'tab' },
		{ path: '/discussions/p2', tag: 'tab' },
		{ path: '/offline', tag: 'tab' },
		{ path: '/offline/activity', tag: 'tab' },
		// 'search'.
		{ path: '/search', tag: 'search' },
		// 'detail': every other route.
		{ path: '/discussion/123', tag: 'detail' },
		{ path: '/discussion/123/slug', tag: 'detail' },
		{ path: '/discussion/123/slug/p1', tag: 'detail' },
		{ path: '/messages/123', tag: 'detail' },
		{ path: '/messages/new', tag: 'detail' },
		{ path: '/messages/add/55', tag: 'detail' },
		{ path: '/post/discussion', tag: 'detail' },
		{ path: '/post/editDiscussion/123', tag: 'detail' },
		{ path: '/bookmarks', tag: 'detail' },
		{ path: '/notifications', tag: 'detail' },
		{ path: '/categories', tag: 'detail' },
		{ path: '/category/news', tag: 'detail' },
		{ path: '/category/news/p2', tag: 'detail' },
		{ path: '/drafts', tag: 'detail' },
		{ path: '/profile', tag: 'detail' },
		{ path: '/profile/settings', tag: 'detail' },
		{ path: '/profile/55/sunny', tag: 'detail' },
		{ path: '/profile/comments/55/sunny', tag: 'detail' },
		{ path: '/profile/discussions/55/sunny', tag: 'detail' },
		{ path: '/profile/appearance', tag: 'detail' },
		{ path: '/profile/invitations', tag: 'detail' },
		{ path: '/admin', tag: 'detail' },
		{ path: '/admin/backups', tag: 'detail' },
		{ path: '/admin/user-groups', tag: 'detail' },
		{ path: '/offline/bookmarks', tag: 'detail' },
		{ path: '/offline/123', tag: 'detail' },
		// Unmatched routes fall through to the 'detail' default.
		{ path: '/entry/signin', tag: 'detail' },
		{ path: '/avatar/55', tag: 'detail' },
		{ path: '/api/users', tag: 'detail' },
		{ path: '/upload', tag: 'detail' }
	];
	for (const { path, tag } of cases) {
		test(`${path} → tag ${tag}`, () => {
			expect(getRouteData(path).tag, `${path} should be tag ${tag}`).toBe(tag);
			expect(getRouteTag(path), `${path} getRouteTag helper`).toBe(tag);
		});
	}
});

describe('getRouteData - fab visibility (record boolean)', () => {
	test('FAB is visible at rest on / and /messages/inbox only', () => {
		expect(getRouteData('/').fab).toBe(true);
		expect(getRouteData('/messages/inbox').fab).toBe(true);
	});
	test('FAB is not visible on every other route', () => {
		const notVisible = [
			'/activity',
			'/discussion/123',
			'/messages/123',
			'/messages/new',
			'/post/discussion',
			'/bookmarks',
			'/search',
			'/profile',
			'/admin',
			'/notifications',
			'/discussions/p2',
			'/offline'
		];
		for (const p of notVisible) {
			expect(getRouteData(p).fab, `${p} should not show the FAB at rest`).toBe(false);
		}
	});
});

describe('getRouteData - snapshotCapture', () => {
	test('/discussion/* captures a deep-page snapshot', () => {
		expect(getRouteData('/discussion/123/slug/p1').snapshotCapture).toBe(true);
	});
	test('every other route does not capture', () => {
		const nonCapturing = [
			'/',
			'/activity',
			'/messages/inbox',
			'/messages/123',
			'/messages/new',
			'/post/discussion',
			'/bookmarks',
			'/search',
			'/profile',
			'/profile/settings',
			'/admin',
			'/offline/123'
		];
		for (const p of nonCapturing) {
			expect(getRouteData(p).snapshotCapture, `${p} should not capture`).toBe(false);
		}
	});
});

describe('getRouteData - backParent (structural parent)', () => {
	interface ParentCase {
		readonly path: string;
		readonly expected: string | undefined;
	}
	const cases: readonly ParentCase[] = [
		// Routes with a declared structural parent.
		{ path: '/profile/settings', expected: '/' },
		{ path: '/profile/55/sunny', expected: '/profile' },
		{ path: '/profile/comments/55/sunny', expected: '/profile/55/sunny' },
		{ path: '/profile/discussions/55/sunny', expected: '/profile/55/sunny' },
		{ path: '/profile/appearance', expected: '/profile/settings' },
		{ path: '/profile/password', expected: '/profile/settings' },
		{ path: '/profile/invitations', expected: '/profile' },
		{ path: '/admin', expected: '/' },
		{ path: '/admin/backups', expected: '/admin' },
		{ path: '/post/discussion', expected: '/' },
		{ path: '/messages/new', expected: '/messages/inbox' },
		// Routes whose structural parent is not in the registry.
		{ path: '/', expected: undefined },
		{ path: '/activity', expected: undefined },
		{ path: '/messages/inbox', expected: undefined },
		{ path: '/discussion/123', expected: undefined },
		{ path: '/messages/123', expected: undefined },
		{ path: '/bookmarks', expected: undefined },
		{ path: '/search', expected: undefined },
		{ path: '/notifications', expected: undefined },
		{ path: '/profile', expected: undefined },
		{ path: '/categories', expected: undefined },
		{ path: '/offline/123', expected: undefined }
	];
	for (const { path, expected } of cases) {
		test(`${path} → backParent ${String(expected)}`, () => {
			expect(getRouteData(path).backParent).toBe(expected);
		});
	}

	test('the public RouteData shape never leaks a backParent resolver', () => {
		// Sanity: a dynamic-parent route still exposes a string, not a function.
		const rd: RouteData = getRouteData('/profile/comments/55/sunny');
		expect(typeof rd.backParent).toBe('string');
		expect(rd.backParent).toBe('/profile/55/sunny');
	});
});

describe('getRouteData - clarity principle (§3)', () => {
	test('the record exposes exactly four fields', () => {
		const rd: RouteData = getRouteData('/discussion/123');
		const keys = Object.keys(rd).sort();
		expect(keys).toEqual(['backParent', 'fab', 'snapshotCapture', 'tag']);
	});
	test('no migration-era fields leak into the record', () => {
		const samples = [
			'/',
			'/activity',
			'/messages/inbox',
			'/search',
			'/discussion/123',
			'/messages/123',
			'/profile/55/sunny',
			'/admin'
		];
		const forbiddenKeys = [
			'isSpatial',
			'headerMode',
			'gestureOwner',
			'spatialNeighbours',
			'fabFamily',
			'fabKind',
			'tabModule',
			'subPager',
			'forcedBackTarget'
		];
		for (const p of samples) {
			const keys = Object.keys(getRouteData(p));
			for (const forbidden of forbiddenKeys) {
				expect(keys.includes(forbidden), `${p} must not carry ${forbidden}`).toBe(false);
			}
		}
	});
});
