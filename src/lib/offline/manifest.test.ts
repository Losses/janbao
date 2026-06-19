// Pure-function unit tests for the DV07 manifest helpers. No Dexie harness
// needed: these cover the depth-policy range computation + the gap scan the
// orchestrator / reader consume. The orchestrator's reason-set update is
// IDB-driven and not unit-testable without a fake-indexeddb harness, so it's
// exercised instead via the integration audit (RV07-C02-*).
import { test, expect } from 'bun:test';
import {
	computeCachedRanges,
	computeReplyGaps,
	isComplete,
	type ReplyGapSummary
} from './manifest';
import type { ReplyCacheManifestRow } from './types';

const PAGE_SIZE = 50;

test('computeCachedRanges first = page 1 only', () => {
	expect(computeCachedRanges('first', 1, PAGE_SIZE)).toEqual([{ start: 1, end: 1 }]);
	expect(computeCachedRanges('first', 10, PAGE_SIZE)).toEqual([{ start: 1, end: 1 }]);
});

test('computeCachedRanges firstLast = first + last page', () => {
	expect(computeCachedRanges('firstLast', 1, PAGE_SIZE)).toEqual([{ start: 1, end: 1 }]);
	expect(computeCachedRanges('firstLast', 2, PAGE_SIZE)).toEqual([
		{ start: 1, end: 1 },
		{ start: 2, end: 2 }
	]);
	expect(computeCachedRanges('firstLast', 10, PAGE_SIZE)).toEqual([
		{ start: 1, end: 1 },
		{ start: 10, end: 10 }
	]);
});

test('computeCachedRanges all under-cap (<=1000) = every page, complete', () => {
	expect(computeCachedRanges('all', 1, PAGE_SIZE)).toEqual([{ start: 1, end: 1 }]);
	// 20 pages * 50 = 1000 rows exactly at the cap boundary.
	expect(computeCachedRanges('all', 20, PAGE_SIZE)).toEqual([{ start: 1, end: 20 }]);
});

test('computeCachedRanges all over-cap (>1000) = first 5 + last 5 pages', () => {
	// 25 pages * 50 = 1250 rows > 1000 ⇒ cap kicks in. Each side = 250 rows
	// = 5 pages at PAGE_SIZE 50.
	expect(computeCachedRanges('all', 25, PAGE_SIZE)).toEqual([
		{ start: 1, end: 5 },
		{ start: 21, end: 25 }
	]);
});

test('computeCachedRanges all over-cap merges when windows meet', () => {
	// 21 pages * 50 = 1050 rows > 1000. capPages = ceil(250/50) = 5. firstEnd
	// = min(5, 21) = 5, lastStart = max(6, 21-5+1=17) = 17. No merge here.
	expect(computeCachedRanges('all', 21, PAGE_SIZE)).toEqual([
		{ start: 1, end: 5 },
		{ start: 17, end: 21 }
	]);
	// Force a merge: tiny pageSize so each window covers most of the thread.
	// pageSize 1000, 3 pages = 2000 rows > cap. capPages = ceil(250/1000) = 1.
	// firstEnd = min(1,3) = 1, lastStart = max(2, 3-1+1=3) = 3 ⇒ windows [1,1]
	// and [3,3]; gap at page 2 remains.
	expect(computeCachedRanges('all', 3, 1000)).toEqual([
		{ start: 1, end: 1 },
		{ start: 3, end: 3 }
	]);
	// And a real merge: pageSize 2000, 1 page is handled by the totalPages===1
	// guard; 2 pages = 2000 rows > cap, capPages=1, firstEnd=1, lastStart=
	// max(2, 2-1+1=2)=2 ⇒ lastStart <= firstEnd+1 ⇒ merge to [{1,2}].
	expect(computeCachedRanges('all', 2, 2000)).toEqual([{ start: 1, end: 2 }]);
});

test('isComplete true iff every page covered', () => {
	expect(isComplete([{ start: 1, end: 5 }], 5)).toBe(true);
	expect(isComplete([{ start: 1, end: 5 }], 10)).toBe(false);
	expect(
		isComplete(
			[
				{ start: 1, end: 1 },
				{ start: 3, end: 3 }
			],
			3
		)
	).toBe(false);
	expect(
		isComplete(
			[
				{ start: 1, end: 1 },
				{ start: 2, end: 3 }
			],
			3
		)
	).toBe(true);
	expect(isComplete([], 0)).toBe(true);
});

test('computeReplyGaps returns empty when no manifest', () => {
	const empty: ReplyGapSummary = computeReplyGaps(undefined, 100);
	expect(empty.gaps).toEqual([]);
	expect(empty.totalMissingPages).toBe(0);
	expect(empty.totalMissingReplies).toBe(0);
});

test('computeReplyGaps returns empty when manifest is complete', () => {
	const manifest: ReplyCacheManifestRow = {
		discussionId: 1,
		totalPages: 5,
		pageSize: PAGE_SIZE,
		cachedRanges: [{ start: 1, end: 5 }],
		complete: true
	};
	const res = computeReplyGaps(manifest, 5 * PAGE_SIZE);
	expect(res.gaps).toEqual([]);
	expect(res.totalMissingPages).toBe(0);
});

test('computeReplyGaps finds a single middle gap (firstLast shape)', () => {
	const manifest: ReplyCacheManifestRow = {
		discussionId: 1,
		totalPages: 10,
		pageSize: PAGE_SIZE,
		cachedRanges: [
			{ start: 1, end: 1 },
			{ start: 10, end: 10 }
		],
		complete: false
	};
	const res = computeReplyGaps(manifest, 10 * PAGE_SIZE);
	expect(res.gaps).toEqual([{ start: 2, end: 9, pageCount: 8 }]);
	expect(res.totalMissingPages).toBe(8);
	expect(res.totalMissingReplies).toBe(8 * PAGE_SIZE);
});

test('computeReplyGaps finds two gaps (over-cap all shape)', () => {
	const manifest: ReplyCacheManifestRow = {
		discussionId: 1,
		totalPages: 25,
		pageSize: PAGE_SIZE,
		cachedRanges: [
			{ start: 1, end: 5 },
			{ start: 21, end: 25 }
		],
		complete: false
	};
	const res = computeReplyGaps(manifest, 25 * PAGE_SIZE);
	expect(res.gaps).toEqual([{ start: 6, end: 20, pageCount: 15 }]);
	expect(res.totalMissingPages).toBe(15);
});

test('computeReplyGaps clamps missing replies to commentCount', () => {
	const manifest: ReplyCacheManifestRow = {
		discussionId: 1,
		totalPages: 25,
		pageSize: PAGE_SIZE,
		cachedRanges: [
			{ start: 1, end: 5 },
			{ start: 21, end: 25 }
		],
		complete: false
	};
	// Stale totalPages ⇒ naive missing = 15*50=750 but the thread really only
	// has 200 replies left uncached. The summary must never report more than
	// commentCount.
	const res = computeReplyGaps(manifest, 200);
	expect(res.totalMissingPages).toBe(15);
	expect(res.totalMissingReplies).toBe(200);
});
