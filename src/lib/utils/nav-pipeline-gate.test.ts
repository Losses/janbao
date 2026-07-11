// src/lib/utils/nav-pipeline-gate.test.ts
/**
 * Unit suite for the pipeline-route gate. The gate is the SOLE selector
 * that decides whether a pathname runs the new DV20 pipeline or the
 * legacy `GesturePageLayout` mechanism; a regression here silently
 * routes a pipeline route through `GesturePageLayout` instead of the
 * pipeline (a UNIFY violation), so the selector is locked down by
 * tests.
 */

import { describe, test, expect } from 'bun:test';
import { isNavPipelineRoute, isPilotTransition } from './nav-pipeline-gate';

describe('isNavPipelineRoute', () => {
	test('matches a numeric conversation detail route', () => {
		expect(isNavPipelineRoute('/messages/1')).toBe(true);
		expect(isNavPipelineRoute('/messages/12345')).toBe(true);
	});

	test('matches a paged conversation (trailing /pN is stripped)', () => {
		expect(isNavPipelineRoute('/messages/123/p2')).toBe(true);
		expect(isNavPipelineRoute('/messages/123/p10')).toBe(true);
	});

	test('matches standalone deep pages', () => {
		expect(isNavPipelineRoute('/search')).toBe(true);
		expect(isNavPipelineRoute('/bookmarks')).toBe(true);
		expect(isNavPipelineRoute('/notifications')).toBe(true);
	});

	test('matches the profile tree', () => {
		expect(isNavPipelineRoute('/profile')).toBe(true);
		expect(isNavPipelineRoute('/profile/settings')).toBe(true);
		expect(isNavPipelineRoute('/profile/appearance')).toBe(true);
		expect(isNavPipelineRoute('/profile/123/some-user')).toBe(true);
		expect(isNavPipelineRoute('/profile/comments/123/some-user')).toBe(true);
		expect(isNavPipelineRoute('/profile/discussions/123/some-user')).toBe(true);
		expect(isNavPipelineRoute('/profile/invitations')).toBe(true);
	});

	test('matches the admin tree', () => {
		expect(isNavPipelineRoute('/admin')).toBe(true);
		expect(isNavPipelineRoute('/admin/backups')).toBe(true);
		expect(isNavPipelineRoute('/admin/categories')).toBe(true);
		expect(isNavPipelineRoute('/admin/maintenance')).toBe(true);
		expect(isNavPipelineRoute('/admin/permissions')).toBe(true);
		expect(isNavPipelineRoute('/admin/stats')).toBe(true);
		expect(isNavPipelineRoute('/admin/user-groups')).toBe(true);
	});

	test('rejects the messages root', () => {
		expect(isNavPipelineRoute('/messages')).toBe(false);
	});

	test('matches the discussion thread', () => {
		expect(isNavPipelineRoute('/discussion/123/some-slug')).toBe(true);
		expect(isNavPipelineRoute('/discussion/123/some-slug/p2')).toBe(true);
		expect(isNavPipelineRoute('/discussion/999/a')).toBe(true);
	});

	test('matches compose routes', () => {
		expect(isNavPipelineRoute('/post/discussion')).toBe(true);
		expect(isNavPipelineRoute('/messages/new')).toBe(true);
	});

	test('matches tab roots', () => {
		expect(isNavPipelineRoute('/')).toBe(true);
		expect(isNavPipelineRoute('/activity')).toBe(true);
		expect(isNavPipelineRoute('/messages/inbox')).toBe(true);
	});

	test('rejects non-migrated routes', () => {
		expect(isNavPipelineRoute('/messages')).toBe(false);
		expect(isNavPipelineRoute('/discussion/123')).toBe(false);
		expect(isNavPipelineRoute('/drafts')).toBe(false);
	});

	test('rejects a non-page suffix after the id (only /pN paged routes are valid)', () => {
		// The route generates /messages/<id> and /messages/<id>/p<N>; the /pN
		// page segment is stripped before the match. Any other suffix is a 404
		// and must not be gated as a pipeline route.
		expect(isNavPipelineRoute('/messages/123/some-suffix')).toBe(false);
	});

	test('rejects a multi-segment path under /messages/<id>', () => {
		// `/messages/123/a/b` has two segments after the id; only one is allowed.
		expect(isNavPipelineRoute('/messages/123/a/b')).toBe(false);
	});
});

describe('isPilotTransition', () => {
	test('owns a transition FROM a pipeline route (gesture / tab-click exit)', () => {
		expect(isPilotTransition('/messages/123', '/messages/inbox')).toBe(true);
		expect(isPilotTransition('/messages/123', '/')).toBe(true);
		expect(isPilotTransition('/bookmarks', '/')).toBe(true);
		expect(isPilotTransition('/profile/settings', '/')).toBe(true);
	});

	test('owns a transition TO a pipeline route (deep-link landing)', () => {
		expect(isPilotTransition('/messages/inbox', '/messages/123')).toBe(true);
		expect(isPilotTransition('/', '/messages/123/p2')).toBe(true);
		expect(isPilotTransition('/', '/bookmarks')).toBe(true);
	});

	test('does not own a transition between two non-pipeline routes', () => {
		expect(isPilotTransition('/discussion/123', '/entry/signin')).toBe(false);
		expect(isPilotTransition(null, '/discussion/123')).toBe(false);
		expect(isPilotTransition('/discussion/123', null)).toBe(false);
		expect(isPilotTransition(null, null)).toBe(false);
	});
});
