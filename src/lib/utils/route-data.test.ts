import { describe, test, expect } from 'bun:test';
import { getRouteData } from './route-data';
import type { RouteTag } from './route-data';

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
		});
	}
});

describe('getRouteData - fab visibility (record boolean)', () => {
	test('FAB is visible at rest on the discussions list (/, /discussions/pN) and /messages/inbox', () => {
		expect(getRouteData('/').fab).toBe(true);
		expect(getRouteData('/discussions/p2').fab).toBe(true);
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
			'/offline'
		];
		for (const p of notVisible) {
			expect(getRouteData(p).fab, `${p} should not show the FAB at rest`).toBe(false);
		}
	});
});

describe('getRouteData - clarity principle (§3)', () => {
	test('the record exposes exactly two fields (matched and unmatched routes)', () => {
		const cases = ['/discussion/123', '/api/users', '/entry/signin', '/upload'];
		for (const p of cases) {
			const keys = Object.keys(getRouteData(p)).sort();
			expect(keys, p).toEqual(['fab', 'tag']);
		}
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
			'/admin',
			'/api/users',
			'/entry/signin'
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
