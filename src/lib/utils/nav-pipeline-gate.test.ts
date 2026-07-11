// src/lib/utils/nav-pipeline-gate.test.ts
/**
 * Unit suite for the 5b1 pilot-route gate. The gate is the SOLE
 * selector that decides whether a pathname runs the new DV20 pipeline
 * or the legacy `GesturePageLayout` mechanism; a regression here
 * silently routes the pilot through `GesturePageLayout` instead of the
 * pipeline (a UNIFY violation), so the selector is locked down by tests.
 */

import { describe, test, expect } from 'bun:test';
import { isNavPipelinePilotRoute, isPilotTransition } from './nav-pipeline-gate';

describe('isNavPipelinePilotRoute', () => {
	test('matches a numeric conversation detail route', () => {
		expect(isNavPipelinePilotRoute('/messages/1')).toBe(true);
		expect(isNavPipelinePilotRoute('/messages/12345')).toBe(true);
	});

	test('matches a paged conversation (trailing /pN is stripped)', () => {
		expect(isNavPipelinePilotRoute('/messages/123/p2')).toBe(true);
		expect(isNavPipelinePilotRoute('/messages/123/p10')).toBe(true);
	});

	test('rejects a non-page suffix after the id (only /pN paged routes are valid)', () => {
		// The route generates /messages/<id> and /messages/<id>/p<N>; the /pN
		// page segment is stripped before the match. Any other suffix is a 404
		// and must not be gated as a pilot route.
		expect(isNavPipelinePilotRoute('/messages/123/some-suffix')).toBe(false);
	});

	test('rejects the inbox (the back-target, not a pilot route)', () => {
		expect(isNavPipelinePilotRoute('/messages/inbox')).toBe(false);
	});

	test('rejects the compose route', () => {
		expect(isNavPipelinePilotRoute('/messages/new')).toBe(false);
	});

	test('rejects the messages root and other routes', () => {
		expect(isNavPipelinePilotRoute('/messages')).toBe(false);
		expect(isNavPipelinePilotRoute('/')).toBe(false);
		expect(isNavPipelinePilotRoute('/discussion/123')).toBe(false);
		expect(isNavPipelinePilotRoute('/profile')).toBe(false);
	});

	test('rejects a multi-segment path under /messages/<id>', () => {
		// `/messages/123/a/b` has two segments after the id; only one is allowed.
		expect(isNavPipelinePilotRoute('/messages/123/a/b')).toBe(false);
	});
});

describe('isPilotTransition', () => {
	test('owns a transition FROM the pilot (gesture / tab-click exit)', () => {
		expect(isPilotTransition('/messages/123', '/messages/inbox')).toBe(true);
		expect(isPilotTransition('/messages/123', '/')).toBe(true);
	});

	test('owns a transition TO the pilot (deep-link landing)', () => {
		expect(isPilotTransition('/messages/inbox', '/messages/123')).toBe(true);
		expect(isPilotTransition('/', '/messages/123/p2')).toBe(true);
	});

	test('does not own a transition between two non-pilot routes', () => {
		expect(isPilotTransition('/', '/activity')).toBe(false);
		expect(isPilotTransition('/messages/inbox', '/')).toBe(false);
		expect(isPilotTransition(null, '/')).toBe(false);
		expect(isPilotTransition('/', null)).toBe(false);
		expect(isPilotTransition(null, null)).toBe(false);
	});
});
