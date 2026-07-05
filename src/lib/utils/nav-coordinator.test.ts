// src/lib/utils/nav-coordinator.test.ts
/**
 * Unit suite for the Layer 4 coordinator (nav-coordinator.ts). Covers
 * the three branches (direct-slide on cache hit, direct-slide with
 * deep-preview on a snapshot route when a snippet exists, chip-exit
 * on miss) and the preload helper.
 *
 * The cache check is injected as a predicate so the suite runs under
 * `bun:test` with no Svelte runes loader.
 */

import { describe, test, expect } from 'bun:test';
import {
	coordinate,
	needsPreload,
	type CacheHasFn,
	type CoordinatorInput
} from './nav-coordinator';

interface BuildInput {
	fromPathname?: string;
	toPathname?: string;
	toSubKey?: string;
	toSnapshotCapture?: boolean;
	cacheHas?: CacheHasFn;
	hasAnySnippet?: boolean;
}

function buildInput(opts: BuildInput = {}): CoordinatorInput {
	return {
		fromPathname: opts.fromPathname ?? '/from',
		toPathname: opts.toPathname ?? '/to',
		toSubKey: opts.toSubKey,
		toSnapshotCapture: opts.toSnapshotCapture ?? false,
		cacheHas: opts.cacheHas ?? (() => false),
		hasAnySnippet: opts.hasAnySnippet ?? false
	};
}

describe('coordinator: direct-slide on cache hit', () => {
	test('cacheHas(to) === true -> direct-slide, no preload, no deep preview', () => {
		const cacheHas: CacheHasFn = (p) => p === '/to';
		const decision = coordinate(buildInput({ toPathname: '/to', cacheHas }));
		expect(decision.strategy).toBe('direct-slide');
		expect(decision.preloadPathname).toBeNull();
		expect(decision.useDeepPreview).toBe(false);
	});

	test('cacheHas respects the subKey', () => {
		const cacheHas: CacheHasFn = (_p, sub) => sub === 'discussions';
		const decision = coordinate(
			buildInput({ toPathname: '/search', toSubKey: 'discussions', cacheHas })
		);
		expect(decision.strategy).toBe('direct-slide');
	});

	test('a subKey miss on a multi-scope route is a chip-exit', () => {
		const cacheHas: CacheHasFn = (_p, sub) => sub === 'discussions';
		const decision = coordinate(buildInput({ toPathname: '/search', toSubKey: 'users', cacheHas }));
		expect(decision.strategy).toBe('chip-exit');
	});
});

describe('coordinator: direct-slide with deep preview', () => {
	test('snapshot route + snippet present -> direct-slide with deep preview', () => {
		const decision = coordinate(
			buildInput({
				toPathname: '/discussion/123',
				toSnapshotCapture: true,
				hasAnySnippet: true,
				cacheHas: () => false
			})
		);
		expect(decision.strategy).toBe('direct-slide');
		expect(decision.useDeepPreview).toBe(true);
		expect(decision.preloadPathname).toBeNull();
	});

	test('snapshot route but no snippet anywhere -> chip-exit', () => {
		const decision = coordinate(
			buildInput({
				toPathname: '/discussion/123',
				toSnapshotCapture: true,
				hasAnySnippet: false,
				cacheHas: () => false
			})
		);
		expect(decision.strategy).toBe('chip-exit');
		expect(decision.useDeepPreview).toBe(false);
	});

	test('non-snapshot route with a snippet elsewhere -> chip-exit (snippet does not apply)', () => {
		const decision = coordinate(
			buildInput({
				toPathname: '/bookmarks',
				toSnapshotCapture: false,
				hasAnySnippet: true,
				cacheHas: () => false
			})
		);
		expect(decision.strategy).toBe('chip-exit');
		expect(decision.useDeepPreview).toBe(false);
	});
});

describe('coordinator: chip-exit on miss', () => {
	test('uncached TO with no snapshot -> chip-exit with preload pathname', () => {
		const decision = coordinate(
			buildInput({
				toPathname: '/profile',
				toSnapshotCapture: false,
				hasAnySnippet: false,
				cacheHas: () => false
			})
		);
		expect(decision.strategy).toBe('chip-exit');
		expect(decision.preloadPathname).toBe('/profile');
	});

	test('chip-exit carries the subKey for preload', () => {
		const decision = coordinate(
			buildInput({
				toPathname: '/search',
				toSubKey: 'users',
				toSnapshotCapture: false,
				hasAnySnippet: false,
				cacheHas: () => false
			})
		);
		expect(decision.preloadSubKey).toBe('users');
	});

	test('needsPreload is true only for chip-exit with a pathname', () => {
		const direct = coordinate(buildInput({ toPathname: '/to', cacheHas: () => true }));
		const chip = coordinate(buildInput({ toPathname: '/to', cacheHas: () => false }));
		expect(needsPreload(direct)).toBe(false);
		expect(needsPreload(chip)).toBe(true);
	});
});

describe('coordinator: cache hit takes precedence over snapshot fallback', () => {
	test('a direct cache hit beats the deep-preview fallback', () => {
		const decision = coordinate(
			buildInput({
				toPathname: '/discussion/123',
				toSnapshotCapture: true,
				hasAnySnippet: true,
				cacheHas: () => true
			})
		);
		// Direct slide without deep preview: the actual entry is cached
		// so there is no need for the snippet overlay.
		expect(decision.useDeepPreview).toBe(false);
	});
});
