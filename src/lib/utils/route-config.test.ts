import { describe, test, expect } from 'bun:test';
import {
	getFabRouteAttributes,
	getTabBarPillTarget,
	getCurrentTabIndex,
	isPagerRoute,
	isPipelineSwipeDisabledRoute,
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
	test('Family B deep routes (non-FAB deep routes) mount the atom at scale 0', () => {
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
		expect(getFabRouteAttributes('/messages/add/55')?.family).toBe('compose');
		expect(getFabRouteAttributes('/messages/add/55')?.kind).toBe('messages');
	});
	test('routes that do not mount the FAB atom return null', () => {
		// /categories, /drafts, /post/editDiscussion/<id>,
		// /entry/*, /avatar/*, /api/*, /upload, /offline/* (offline routes mount
		// DualColumnLayout only and do not participate in the FAB layer).
		const none = [
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

describe('isPipelineSwipeDisabledRoute - DualColumnLayout yield gate', () => {
	// Masked latent bug: `/search`, `/bookmarks`, `/notifications`,
	// `/profile`, and `/messages/add/[userId]` mount a NavPipelineHost but
	// the function returns FALSE because the first four carry
	// `kind: 'deep'` (failing the overlay branch) and `/messages/add/[userId]`
	// carries a compose-family attribute (also failing the overlay branch);
	// all five have no declared `backParent` (failing the deep-route branch).
	// Sub-pages of `/profile` and the `/admin/*` tree declare `backParent`,
	// so they return TRUE; the latent-bug set is these five leaf routes.
	// The race does not manifest (NavPipelineHost wins pointer capture);
	// the function and the bug dissolve in 5b3 when the DualColumnLayout
	// detectSwipe is removed.
	test('true for thread / conversation routes (Family B overlay, non-deep kind)', () => {
		expect(isPipelineSwipeDisabledRoute('/discussion/123')).toBe(true);
		expect(isPipelineSwipeDisabledRoute('/discussion/123/slug/p1')).toBe(true);
		expect(isPipelineSwipeDisabledRoute('/messages/123')).toBe(true);
		expect(isPipelineSwipeDisabledRoute('/messages/123/p2')).toBe(true);
	});
	test('true for routes whose structural parent is declared in the registry', () => {
		expect(isPipelineSwipeDisabledRoute('/profile/settings')).toBe(true);
		expect(isPipelineSwipeDisabledRoute('/profile/55/sunny')).toBe(true);
		expect(isPipelineSwipeDisabledRoute('/profile/comments/55/sunny')).toBe(true);
		expect(isPipelineSwipeDisabledRoute('/profile/discussions/55/sunny')).toBe(true);
		expect(isPipelineSwipeDisabledRoute('/profile/appearance')).toBe(true);
		expect(isPipelineSwipeDisabledRoute('/profile/invitations')).toBe(true);
		expect(isPipelineSwipeDisabledRoute('/admin')).toBe(true);
		expect(isPipelineSwipeDisabledRoute('/admin/backups')).toBe(true);
		expect(isPipelineSwipeDisabledRoute('/post/discussion')).toBe(true);
		expect(isPipelineSwipeDisabledRoute('/messages/new')).toBe(true);
	});
	test('latent-bug leaf routes return FALSE; backParent-declaring sub-pages return TRUE', () => {
		expect(isPipelineSwipeDisabledRoute('/search')).toBe(false);
		expect(isPipelineSwipeDisabledRoute('/bookmarks')).toBe(false);
		expect(isPipelineSwipeDisabledRoute('/notifications')).toBe(false);
		expect(isPipelineSwipeDisabledRoute('/profile')).toBe(false);
		expect(isPipelineSwipeDisabledRoute('/messages/add/55')).toBe(false);
		expect(isPipelineSwipeDisabledRoute('/admin/user-groups')).toBe(true);
	});
	test('false for tab roots, tab-internal pagination, offline routes, unmatched', () => {
		expect(isPipelineSwipeDisabledRoute('/')).toBe(false);
		expect(isPipelineSwipeDisabledRoute('/activity')).toBe(false);
		expect(isPipelineSwipeDisabledRoute('/messages/inbox')).toBe(false);
		expect(isPipelineSwipeDisabledRoute('/discussions/p2')).toBe(false);
		expect(isPipelineSwipeDisabledRoute('/offline')).toBe(false);
		expect(isPipelineSwipeDisabledRoute('/offline/123')).toBe(false);
		expect(isPipelineSwipeDisabledRoute('/entry/signin')).toBe(false);
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
