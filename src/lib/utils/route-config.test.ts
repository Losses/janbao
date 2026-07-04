import { describe, test, expect } from 'bun:test';
import {
	getFabRouteAttributes,
	getTabBarPillTarget,
	getCurrentTabIndex,
	isPagerRoute,
	isGesturePageLayoutRoute,
	backTargetListKind,
	getPreviewPanel
} from './route-config';

describe('getFabRouteAttributes - the FAB atom-mount registry', () => {
	test('Family A list routes mount the FAB atom', () => {
		expect(getFabRouteAttributes('/')?.family).toBe('list');
		expect(getFabRouteAttributes('/')?.kind).toBe('discussions');
		expect(getFabRouteAttributes('/messages/inbox')?.family).toBe('list');
		expect(getFabRouteAttributes('/messages/inbox')?.kind).toBe('messages');
		expect(getFabRouteAttributes('/activity')?.family).toBe('list');
		expect(getFabRouteAttributes('/activity')?.kind).toBe('dynamic');
	});
	test('Family B overlay routes mount the FAB atom (threads + conversations)', () => {
		expect(getFabRouteAttributes('/discussion/123')?.family).toBe('overlay');
		expect(getFabRouteAttributes('/discussion/123')?.kind).toBe('discussions');
		expect(getFabRouteAttributes('/messages/123')?.family).toBe('overlay');
		expect(getFabRouteAttributes('/messages/123')?.kind).toBe('messages');
	});
	test('Family B deep routes (non-FAB GPL routes) mount the atom at scale 0', () => {
		const deep = [
			'/bookmarks',
			'/search',
			'/notifications',
			'/profile',
			'/profile/settings',
			'/profile/55/sunny',
			'/admin',
			'/admin/backups'
		];
		for (const p of deep) {
			const attrs = getFabRouteAttributes(p);
			expect(attrs, `${p} must have FAB attrs`).not.toBeNull();
			expect(attrs?.family, `${p} family must be overlay`).toBe('overlay');
			expect(attrs?.kind, `${p} kind must be deep`).toBe('deep');
		}
	});
	test('Family C compose routes mount the FAB atom', () => {
		expect(getFabRouteAttributes('/post/discussion')?.family).toBe('compose');
		expect(getFabRouteAttributes('/post/discussion')?.kind).toBe('discussions');
		expect(getFabRouteAttributes('/messages/new')?.family).toBe('compose');
		expect(getFabRouteAttributes('/messages/new')?.kind).toBe('messages');
	});
	test('routes that do not mount the FAB atom return null', () => {
		// /messages/add/<uid>, /categories, /drafts, /post/editDiscussion/<id>,
		// /entry/*, /avatar/*, /api/*, /upload, /offline/* (offline routes mount
		// DualColumnLayout only and do not participate in the FAB layer).
		const none = [
			'/messages/add/55',
			'/categories',
			'/category/news',
			'/drafts',
			'/post/editDiscussion/123',
			'/offline',
			'/offline/activity',
			'/offline/123',
			'/offline/bookmarks',
			'/discussions/p2',
			'/entry/signin',
			'/avatar/55',
			'/api/users',
			'/upload'
		];
		for (const p of none) {
			expect(getFabRouteAttributes(p), `${p} must not mount the FAB atom`).toBeNull();
		}
	});
});

describe('getTabBarPillTarget - the §3 tab-bar consumer config', () => {
	test('spatial tab roots resolve to their pill', () => {
		expect(getTabBarPillTarget('/')).toBe('discussions');
		expect(getTabBarPillTarget('/activity')).toBe('activity');
		expect(getTabBarPillTarget('/messages/inbox')).toBe('messages');
	});
	test('tab-internal pagination inherits the source tab pill', () => {
		expect(getTabBarPillTarget('/discussions/p2')).toBe('discussions');
	});
	test('thread / conversation / compose routes inherit the source list pill', () => {
		expect(getTabBarPillTarget('/discussion/123')).toBe('discussions');
		expect(getTabBarPillTarget('/messages/123')).toBe('messages');
		expect(getTabBarPillTarget('/post/discussion')).toBe('discussions');
		expect(getTabBarPillTarget('/messages/new')).toBe('messages');
	});
	test('offline tab mirrors resolve to their pill', () => {
		expect(getTabBarPillTarget('/offline')).toBe('discussions');
		expect(getTabBarPillTarget('/offline/activity')).toBe('activity');
	});
	test('offline detail mirrors inherit the discussions pill (mirror of /discussion/<id> and /bookmarks)', () => {
		// The broad /^\/offline/ prefix matches every offline sub-path;
		// /offline/<id> and /offline/bookmarks stay tab-associated
		// (Cycle 1 spec's behavior-preservation rule; Cycle 6 brings the
		// offline detail routes fully into the gesture layer).
		expect(getTabBarPillTarget('/offline/123')).toBe('discussions');
		expect(getTabBarPillTarget('/offline/bookmarks')).toBe('discussions');
	});
	test('global routes follow the active tab (§3 active pill target)', () => {
		expect(getTabBarPillTarget('/admin')).toBe('active');
		expect(getTabBarPillTarget('/admin/backups')).toBe('active');
		expect(getTabBarPillTarget('/profile')).toBe('active');
		expect(getTabBarPillTarget('/profile/settings')).toBe('active');
		expect(getTabBarPillTarget('/search')).toBe('active');
		expect(getTabBarPillTarget('/bookmarks')).toBe('active');
		expect(getTabBarPillTarget('/notifications')).toBe('active');
	});
	test('unmatched routes resolve to none (no pill, no tab highlight)', () => {
		expect(getTabBarPillTarget('/messages/add/55')).toBe('none');
		expect(getTabBarPillTarget('/categories')).toBe('none');
		expect(getTabBarPillTarget('/drafts')).toBe('none');
		expect(getTabBarPillTarget('/entry/signin')).toBe('none');
	});
});

describe('getCurrentTabIndex - one-line read of the tab-bar config', () => {
	test('the three spatial tab roots', () => {
		expect(getCurrentTabIndex('/')).toBe(0);
		expect(getCurrentTabIndex('/activity')).toBe(1);
		expect(getCurrentTabIndex('/messages/inbox')).toBe(2);
	});
	test('thread / conversation / compose routes resolve to their source tab', () => {
		expect(getCurrentTabIndex('/discussion/123')).toBe(0);
		expect(getCurrentTabIndex('/messages/123')).toBe(2);
		expect(getCurrentTabIndex('/post/discussion')).toBe(0);
		expect(getCurrentTabIndex('/messages/new')).toBe(2);
	});
	test('tab-internal pagination and offline tab mirrors', () => {
		expect(getCurrentTabIndex('/discussions/p2')).toBe(0);
		expect(getCurrentTabIndex('/offline')).toBe(0);
		expect(getCurrentTabIndex('/offline/activity')).toBe(1);
	});
	test('offline detail mirrors resolve to the discussions tab (mirror of /discussion/<id>)', () => {
		// The broad /^\/offline/ prefix matches /offline/<id> and
		// /offline/bookmarks; both stay discussions-tab-associated.
		expect(getCurrentTabIndex('/offline/123')).toBe(0);
		expect(getCurrentTabIndex('/offline/bookmarks')).toBe(0);
	});
	test('global routes return -1 (no tab highlight; pill follows the active tab in a later cycle)', () => {
		const globalRoutes = [
			'/admin',
			'/admin/backups',
			'/profile',
			'/profile/settings',
			'/profile/55/sunny',
			'/search',
			'/bookmarks',
			'/notifications'
		];
		for (const p of globalRoutes) {
			expect(getCurrentTabIndex(p), `${p} should resolve to -1`).toBe(-1);
		}
	});
	test('unmatched routes return -1', () => {
		expect(getCurrentTabIndex('/messages/add/55')).toBe(-1);
		expect(getCurrentTabIndex('/categories')).toBe(-1);
		expect(getCurrentTabIndex('/entry/signin')).toBe(-1);
	});
});

describe('isPagerRoute - positional query over MOBILE_TAB_DEFS', () => {
	test('true only for the three spatial tab positions', () => {
		expect(isPagerRoute('/')).toBe(true);
		expect(isPagerRoute('/activity')).toBe(true);
		expect(isPagerRoute('/messages/inbox')).toBe(true);
	});
	test('false for tab-internal pagination, deep routes, offline mirrors', () => {
		const notRoots = [
			'/discussions/p2',
			'/discussion/123',
			'/messages/123',
			'/messages/new',
			'/messages/add/55',
			'/messages/inbox/extra',
			'/search',
			'/bookmarks',
			'/profile',
			'/admin',
			'/offline',
			'/offline/activity',
			'/offline/123'
		];
		for (const p of notRoots) {
			expect(isPagerRoute(p), `${p} is not a pager route`).toBe(false);
		}
	});
});

describe('isGesturePageLayoutRoute - migration-era imperative (deferred to Cycle 5)', () => {
	// The function's answer set is preserved verbatim per the Cycle 1 spec;
	// the latent bug (TRUE answer for /search, /bookmarks, /profile, /admin,
	// /notifications and the sub-pages of the last four) is NOT fixed in
	// this cycle. Cycle 5 dissolves the function and the bug together.
	test('true for thread / conversation routes (Family B overlay, non-deep kind)', () => {
		expect(isGesturePageLayoutRoute('/discussion/123')).toBe(true);
		expect(isGesturePageLayoutRoute('/discussion/123/slug/p1')).toBe(true);
		expect(isGesturePageLayoutRoute('/messages/123')).toBe(true);
		expect(isGesturePageLayoutRoute('/messages/123/p2')).toBe(true);
	});
	test('true for routes whose structural parent is declared in the registry', () => {
		expect(isGesturePageLayoutRoute('/profile/settings')).toBe(true);
		expect(isGesturePageLayoutRoute('/profile/55/sunny')).toBe(true);
		expect(isGesturePageLayoutRoute('/profile/comments/55/sunny')).toBe(true);
		expect(isGesturePageLayoutRoute('/profile/discussions/55/sunny')).toBe(true);
		expect(isGesturePageLayoutRoute('/profile/appearance')).toBe(true);
		expect(isGesturePageLayoutRoute('/profile/invitations')).toBe(true);
		expect(isGesturePageLayoutRoute('/admin')).toBe(true);
		expect(isGesturePageLayoutRoute('/admin/backups')).toBe(true);
		expect(isGesturePageLayoutRoute('/post/discussion')).toBe(true);
		expect(isGesturePageLayoutRoute('/messages/new')).toBe(true);
	});
	test('FALSE for non-FAB GPL routes (latent bug; deferred to Cycle 5)', () => {
		// These routes DO mount a GPL today, but isGesturePageLayoutRoute
		// returns false because they carry kind: 'deep' (failing the
		// thread/conversation branch) and have no declared backParent
		// (failing the deep-route-parent branch). The function stays
		// imperative per the spec; the bug is preserved verbatim.
		expect(isGesturePageLayoutRoute('/search')).toBe(false);
		expect(isGesturePageLayoutRoute('/bookmarks')).toBe(false);
		expect(isGesturePageLayoutRoute('/notifications')).toBe(false);
		expect(isGesturePageLayoutRoute('/profile')).toBe(false);
		expect(isGesturePageLayoutRoute('/admin/user-groups')).toBe(true);
	});
	test('false for tab roots, tab-internal pagination, offline routes, unmatched', () => {
		expect(isGesturePageLayoutRoute('/')).toBe(false);
		expect(isGesturePageLayoutRoute('/activity')).toBe(false);
		expect(isGesturePageLayoutRoute('/messages/inbox')).toBe(false);
		expect(isGesturePageLayoutRoute('/discussions/p2')).toBe(false);
		expect(isGesturePageLayoutRoute('/offline')).toBe(false);
		expect(isGesturePageLayoutRoute('/offline/123')).toBe(false);
		expect(isGesturePageLayoutRoute('/entry/signin')).toBe(false);
	});
});

describe('backTargetListKind - back-target string classifier (not a route classifier)', () => {
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

describe('getPreviewPanel - back-preview snippet component', () => {
	test('profile / admin routes resolve to their preview panel', () => {
		expect(getPreviewPanel('/profile/settings')).not.toBeNull();
		expect(getPreviewPanel('/profile/55/sunny')).not.toBeNull();
		expect(getPreviewPanel('/profile/comments/55/sunny')).not.toBeNull();
		expect(getPreviewPanel('/admin')).not.toBeNull();
		expect(getPreviewPanel('/admin/backups')).not.toBeNull();
	});
	test('thread / conversation / compose / list routes resolve to null (no dedicated preview)', () => {
		expect(getPreviewPanel('/discussion/123')).toBeNull();
		expect(getPreviewPanel('/messages/123')).toBeNull();
		expect(getPreviewPanel('/post/discussion')).toBeNull();
		expect(getPreviewPanel('/messages/new')).toBeNull();
		expect(getPreviewPanel('/')).toBeNull();
		expect(getPreviewPanel('/bookmarks')).toBeNull();
	});
});
