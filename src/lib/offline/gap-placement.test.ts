// Unit tests for the multi-range gap-placement helper. Pins the shapes
// RV07-C04-Audit-01 A4-2 enumerated: firstLast, all under/over-cap, single
// visited page, OP-only. Pure functions; no Dexie harness needed.
import { test, expect } from 'bun:test';
import { computeGapPlacements } from './gap-placement';
import type { CachedRange } from './types';
import type { ReplyGap } from './manifest';

const PAGE_SIZE = 50;

function range(start: number, end: number): CachedRange {
	return { start, end };
}

function gap(start: number, end: number): ReplyGap {
	return { start, end, pageCount: end - start + 1 };
}

test('firstLast [{1,1},{10,10}]: one divider at the page-1/page-10 boundary', () => {
	// 10 pages, page 1 + page 10 cached. Page 1 holds the OP-excluded first
	// page (pageSize replies since OP is rendered separately). The divider
	// lands after the page-1 block, before the page-10 block.
	const res = computeGapPlacements({
		cachedRanges: [range(1, 1), range(10, 10)],
		gaps: [gap(2, 9)],
		pageSize: PAGE_SIZE,
		totalPages: 10,
		cachedReplyCount: 2 * PAGE_SIZE // page 1 + page 10 = 100 replies
	});
	expect(res.restNotCached).toBeNull();
	expect(res.placements).toEqual([
		{ gap: gap(2, 9), beforeIndex: PAGE_SIZE, approxReplies: 8 * PAGE_SIZE }
	]);
});

test('all under-cap (single complete range): no dividers, no rest hint', () => {
	const res = computeGapPlacements({
		cachedRanges: [range(1, 5)],
		gaps: [],
		pageSize: PAGE_SIZE,
		totalPages: 5,
		cachedReplyCount: 5 * PAGE_SIZE
	});
	expect(res.placements).toEqual([]);
	expect(res.restNotCached).toBeNull();
});

test('all over-cap [{1,5},{17,21}]: divider after the page-1..5 block', () => {
	// 21 pages, pageSize 50. First 5 + last 5 cached. Divider after the first
	// block (5 * 50 = 250 replies).
	const res = computeGapPlacements({
		cachedRanges: [range(1, 5), range(17, 21)],
		gaps: [gap(6, 16)],
		pageSize: PAGE_SIZE,
		totalPages: 21,
		cachedReplyCount: 10 * PAGE_SIZE
	});
	expect(res.restNotCached).toBeNull();
	expect(res.placements).toEqual([
		{ gap: gap(6, 16), beforeIndex: 5 * PAGE_SIZE, approxReplies: 11 * PAGE_SIZE }
	]);
});

test('single visited page [{3,3}]: two dividers, before and after page 3', () => {
	// 5 pages, only page 3 cached. Gaps: [1,2] (before) and [4,5] (after).
	// No cached replies precede the first gap → beforeIndex=0. The second gap
	// follows all 1 cached page → beforeIndex = 1*pageSize = 50.
	const res = computeGapPlacements({
		cachedRanges: [range(3, 3)],
		gaps: [gap(1, 2), gap(4, 5)],
		pageSize: PAGE_SIZE,
		totalPages: 5,
		cachedReplyCount: PAGE_SIZE
	});
	expect(res.restNotCached).toBeNull();
	expect(res.placements).toEqual([
		{ gap: gap(1, 2), beforeIndex: 0, approxReplies: 2 * PAGE_SIZE },
		{ gap: gap(4, 5), beforeIndex: PAGE_SIZE, approxReplies: 2 * PAGE_SIZE }
	]);
});

test('OP-only (no cached ranges): single trailing restNotCached hint', () => {
	// OP cached but no paginated pages. The renderer shows a single "rest not
	// cached" hint after the OP block.
	const res = computeGapPlacements({
		cachedRanges: [],
		gaps: [gap(1, 5)],
		pageSize: PAGE_SIZE,
		totalPages: 5,
		cachedReplyCount: 0
	});
	expect(res.placements).toEqual([]);
	expect(res.restNotCached).toEqual({
		approxReplies: 5 * PAGE_SIZE,
		uncachedPages: 5
	});
});

test('OP-only with no gaps (degenerate 0-page thread): no hint', () => {
	// Thread with only an OP — totalPages=1, but the manifest's [1,1] would
	// not exist (no paginated stream). Defensive: no placements, no hint.
	const res = computeGapPlacements({
		cachedRanges: [],
		gaps: [],
		pageSize: PAGE_SIZE,
		totalPages: 0,
		cachedReplyCount: 0
	});
	expect(res.placements).toEqual([]);
	expect(res.restNotCached).toBeNull();
});

test('manifest slots exist but all replies evicted: fall back to restNotCached', () => {
	// Defense: a range claims slots but cachedReplyCount=0 (every reply was
	// evicted). Suppress inline dividers (nothing to anchor to) and surface a
	// trailing hint instead.
	const res = computeGapPlacements({
		cachedRanges: [range(1, 5)],
		gaps: [gap(6, 10)],
		pageSize: PAGE_SIZE,
		totalPages: 10,
		cachedReplyCount: 0
	});
	expect(res.placements).toEqual([]);
	expect(res.restNotCached).toEqual({
		approxReplies: 5 * PAGE_SIZE,
		uncachedPages: 5
	});
});

test('divider clamps beforeIndex to cachedReplyCount', () => {
	// Stale manifest: claims page 1 (50 slots) but only 10 cached replies
	// survive. The divider must clamp to 10, not 50.
	const res = computeGapPlacements({
		cachedRanges: [range(1, 1), range(10, 10)],
		gaps: [gap(2, 9)],
		pageSize: PAGE_SIZE,
		totalPages: 10,
		cachedReplyCount: 10
	});
	expect(res.placements.length).toBe(1);
	expect(res.placements[0].beforeIndex).toBe(10);
});

test('three-range manifest: two dividers at each interior gap', () => {
	// C04 multi-range: passthrough visited page 1, 5, 10 of a 10-page thread.
	const res = computeGapPlacements({
		cachedRanges: [range(1, 1), range(5, 5), range(10, 10)],
		gaps: [gap(2, 4), gap(6, 9)],
		pageSize: PAGE_SIZE,
		totalPages: 10,
		cachedReplyCount: 3 * PAGE_SIZE
	});
	expect(res.restNotCached).toBeNull();
	expect(res.placements).toEqual([
		{ gap: gap(2, 4), beforeIndex: PAGE_SIZE, approxReplies: 3 * PAGE_SIZE },
		{ gap: gap(6, 9), beforeIndex: 2 * PAGE_SIZE, approxReplies: 4 * PAGE_SIZE }
	]);
});
