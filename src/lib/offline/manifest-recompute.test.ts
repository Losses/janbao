// Pure-function unit tests for the DV07 C04 authoritative manifest merge
// (mergePageRange). No Dexie harness: this covers the range-union logic the
// orchestrator + passthrough both rely on. The IDB-read part of
// recomputeManifestForDiscussion is exercised via the integration audit
// (RV07-C04-*) since the repo has no fake-indexeddb harness.
import { test, expect } from 'bun:test';
import { mergePageRange } from './manifest-recompute';
import type { CachedRange, ReplyCacheManifestRow } from './types';

const PAGE_SIZE = 50;

function merge(
	discussionId: number,
	commentCount: number,
	pageStart: number,
	pageEnd: number,
	existingRanges: CachedRange[]
): ReplyCacheManifestRow {
	return mergePageRange({
		discussionId,
		commentCount,
		pageSize: PAGE_SIZE,
		pageStart,
		pageEnd,
		existingRanges
	}).manifest;
}

test('mergePageRange: first write = single range', () => {
	// commentCount=500 → non-OP=499 → totalPages=ceil(499/50)=10.
	const m = merge(1, 500, 1, 1, []);
	expect(m.totalPages).toBe(10);
	expect(m.cachedRanges).toEqual([{ start: 1, end: 1 }]);
	expect(m.complete).toBe(false);
});

test('mergePageRange: complete thread (1 page)', () => {
	// commentCount=50 includes OP → non-OP=49 → totalPages=1.
	const m = merge(1, 50, 1, 1, []);
	expect(m.totalPages).toBe(1);
	expect(m.cachedRanges).toEqual([{ start: 1, end: 1 }]);
	expect(m.complete).toBe(true);
});

test('mergePageRange: two non-contiguous ranges (firstLast depth)', () => {
	// Sync writes page 1, then page 10. Two separate calls.
	const after1 = merge(1, 500, 1, 1, []);
	const after10 = merge(1, 500, 10, 10, after1.cachedRanges);
	expect(after10.cachedRanges).toEqual([
		{ start: 1, end: 1 },
		{ start: 10, end: 10 }
	]);
	expect(after10.complete).toBe(false);
});

test('mergePageRange: union of curated depth=all + passthrough page 5 (no lost update)', () => {
	// Sync depth 'all' under-cap cached pages 1..10 (single range). Passthrough
	// then visits page 5 - already in the range. Result unchanged. This is the
	// CO-C02-1 + lost-update guard.
	const afterSync = merge(1, 500, 1, 10, []);
	const afterPassthrough = merge(1, 500, 5, 5, afterSync.cachedRanges);
	expect(afterPassthrough.cachedRanges).toEqual([{ start: 1, end: 10 }]);
	expect(afterPassthrough.complete).toBe(true);
});

test('mergePageRange: passthrough middle page adds a new range', () => {
	// Curated depth 'firstLast' cached pages 1 + 10. Passthrough visit to page 5
	// adds a new range. Before C04 the manifest would have been overwritten with
	// the depth-only manifest (lost update).
	const after1 = merge(1, 500, 1, 1, []);
	const after10 = merge(1, 500, 10, 10, after1.cachedRanges);
	const after5 = merge(1, 500, 5, 5, after10.cachedRanges);
	expect(after5.cachedRanges).toEqual([
		{ start: 1, end: 1 },
		{ start: 5, end: 5 },
		{ start: 10, end: 10 }
	]);
	expect(after5.complete).toBe(false);
});

test('mergePageRange: adjacent ranges coalesce', () => {
	// Pages 1, 2, 3 added in sequence should coalesce to [1,3].
	const after1 = merge(1, 500, 1, 1, []);
	const after2 = merge(1, 500, 2, 2, after1.cachedRanges);
	const after3 = merge(1, 500, 3, 3, after2.cachedRanges);
	expect(after3.cachedRanges).toEqual([{ start: 1, end: 3 }]);
	expect(after3.complete).toBe(false);
});

test('mergePageRange: overlapping ranges coalesce', () => {
	// Page 1..5 then page 3..7 → [1,7].
	const after5 = merge(1, 500, 1, 5, []);
	const after7 = merge(1, 500, 3, 7, after5.cachedRanges);
	expect(after7.cachedRanges).toEqual([{ start: 1, end: 7 }]);
});

test('mergePageRange: range clamped to totalPages', () => {
	// Writer claims page 15 but totalPages=10 → clamped to 10.
	const m = merge(1, 500, 15, 15, []);
	expect(m.cachedRanges).toEqual([{ start: 10, end: 10 }]);
});

test('mergePageRange: empty thread (commentCount=1, OP only)', () => {
	// commentCount=1 → non-OP=0 → totalPages=1. OP cached → page 1 complete.
	const m = merge(1, 1, 1, 1, []);
	expect(m.totalPages).toBe(1);
	expect(m.cachedRanges).toEqual([{ start: 1, end: 1 }]);
	expect(m.complete).toBe(true);
});

test('mergePageRange: multi-page range (depth all under-cap)', () => {
	// commentCount=500 → totalPages=10. Depth 'all' writes [1,10] in one call.
	const m = merge(1, 500, 1, 10, []);
	expect(m.cachedRanges).toEqual([{ start: 1, end: 10 }]);
	expect(m.complete).toBe(true);
});

test('mergePageRange: stale commentCount growth flips complete → partial', () => {
	// Initially 500 replies, all 10 pages cached → complete.
	const complete = merge(1, 500, 1, 10, []);
	expect(complete.complete).toBe(true);
	// Thread grew to 600 replies → totalPages=12. Same cached ranges now miss
	// pages 11-12. A subsequent merge with the same range re-evaluates complete.
	const grown = merge(1, 600, 1, 10, complete.cachedRanges);
	expect(grown.totalPages).toBe(12);
	expect(grown.cachedRanges).toEqual([{ start: 1, end: 10 }]);
	expect(grown.complete).toBe(false);
});

// Type-narrowing smoke test: the returned manifest matches ReplyCacheManifestRow.
test('mergePageRange: output matches ReplyCacheManifestRow shape', () => {
	const m = merge(7, 100, 1, 1, []);
	const row: ReplyCacheManifestRow = m;
	expect(row.discussionId).toBe(7);
	expect(row.pageSize).toBe(PAGE_SIZE);
});
