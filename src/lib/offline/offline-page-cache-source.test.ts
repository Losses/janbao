// src/lib/offline/offline-page-cache-source.test.ts
/**
 * Unit suite for the IDB-backed `PageCacheDataSource`. The source is the
 * first non-trivial registered source in the integrated pipeline (Cycle 6);
 * its responsibility set + its read delegation are locked down here so a
 * regression cannot silently mis-route an offline pathname or stop wrapping
 * the underlying IDB loaders.
 *
 * The IDB loaders themselves are mocked per-test so the suite runs without
 * a Dexie instance (bun:test has no IDB shim). The mocked loaders record
 * their calls so the assertions can verify delegation.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock the IDB loaders BEFORE importing the module under test, so the
// module's eager `registerOfflinePageCacheSource()` call (which runs at
// import time) sees the mocks in place. The mock returns deterministic
// arrays per pathname.
const loadOfflineDiscussions = mock(() => Promise.resolve([{ id: 1, title: 'd1' }]));
const loadOfflineActivity = mock(() => Promise.resolve([{ id: 9, contentJson: 'a' }]));
const loadOfflineBookmarks = mock(() => Promise.resolve([{ discussionId: 1, title: 'b1' }]));

mock.module('$lib/offline/queries', () => ({
	loadOfflineDiscussions,
	loadOfflineActivity,
	loadOfflineBookmarks
}));

// Mock the page-cache store so the eager registration does not touch the
// real singleton. The mock records `registerSource` calls so the
// `eager registration` describe block can verify the side-effect.
const registerSource = mock(() => {});
const getPageCacheStore = mock(() => ({ registerSource }));
mock.module('$lib/stores/page-cache.svelte', () => ({ getPageCacheStore }));

const { offlinePageCacheSource } = await import('./offline-page-cache-source');

describe('eager registration', () => {
	test('registers the source with the page-cache store at module load', () => {
		expect(registerSource).toHaveBeenCalledTimes(1);
		expect(registerSource).toHaveBeenCalledWith(offlinePageCacheSource);
	});
});

describe('offlinePageCacheSource.isResponsibleFor', () => {
	beforeEach(() => {
		loadOfflineDiscussions.mockClear();
		loadOfflineActivity.mockClear();
		loadOfflineBookmarks.mockClear();
	});

	test('owns the three offline LIST pathnames', () => {
		expect(offlinePageCacheSource.isResponsibleFor('/offline', undefined)).toBe(true);
		expect(offlinePageCacheSource.isResponsibleFor('/offline/activity', undefined)).toBe(true);
		expect(offlinePageCacheSource.isResponsibleFor('/offline/bookmarks', undefined)).toBe(true);
	});

	test('does not own the offline thread (its +page.ts load is the data path)', () => {
		expect(offlinePageCacheSource.isResponsibleFor('/offline/123', undefined)).toBe(false);
	});

	test('does not own online routes', () => {
		expect(offlinePageCacheSource.isResponsibleFor('/', undefined)).toBe(false);
		expect(offlinePageCacheSource.isResponsibleFor('/activity', undefined)).toBe(false);
		expect(offlinePageCacheSource.isResponsibleFor('/bookmarks', undefined)).toBe(false);
		expect(offlinePageCacheSource.isResponsibleFor('/discussion/123/slug', undefined)).toBe(false);
	});
});

describe('offlinePageCacheSource.read', () => {
	beforeEach(() => {
		loadOfflineDiscussions.mockClear();
		loadOfflineActivity.mockClear();
		loadOfflineBookmarks.mockClear();
	});

	test('delegates /offline to loadOfflineDiscussions', async () => {
		const data = await offlinePageCacheSource.read('/offline', undefined);
		expect(data).toEqual([{ id: 1, title: 'd1' }]);
		expect(loadOfflineDiscussions).toHaveBeenCalledTimes(1);
		expect(loadOfflineActivity).not.toHaveBeenCalled();
		expect(loadOfflineBookmarks).not.toHaveBeenCalled();
	});

	test('delegates /offline/activity to loadOfflineActivity', async () => {
		const data = await offlinePageCacheSource.read('/offline/activity', undefined);
		expect(data).toEqual([{ id: 9, contentJson: 'a' }]);
		expect(loadOfflineActivity).toHaveBeenCalledTimes(1);
		expect(loadOfflineDiscussions).not.toHaveBeenCalled();
		expect(loadOfflineBookmarks).not.toHaveBeenCalled();
	});

	test('delegates /offline/bookmarks to loadOfflineBookmarks', async () => {
		const data = await offlinePageCacheSource.read('/offline/bookmarks', undefined);
		expect(data).toEqual([{ discussionId: 1, title: 'b1' }]);
		expect(loadOfflineBookmarks).toHaveBeenCalledTimes(1);
		expect(loadOfflineDiscussions).not.toHaveBeenCalled();
		expect(loadOfflineActivity).not.toHaveBeenCalled();
	});

	test('returns null for a pathname it does not own', async () => {
		const data = await offlinePageCacheSource.read('/offline/123', undefined);
		expect(data).toBeNull();
		expect(loadOfflineDiscussions).not.toHaveBeenCalled();
		expect(loadOfflineActivity).not.toHaveBeenCalled();
		expect(loadOfflineBookmarks).not.toHaveBeenCalled();
	});
});
