// DV07 reply-cache manifest helpers. Pure functions over (depth, totalPages,
// pageSize, commentCount) so they are unit-testable without a Dexie harness.
// Two layers:
//
//  - computeCachedRanges / isComplete: derived from the depth policy. Used by
//    the orchestrator to (re)write a ReplyCacheManifestRow on every sync.
//  - computeReplyGaps: derived from a stored manifest + commentCount. Used by
//    the offline reader to render the uncached page-ranges (C04 will switch
//    the renderer from the single-divider partialGap to this multi-gap view).
//
// Depth policy (Plan decision #3):
//   'first'      -> [{1,1}]
//   'firstLast'  -> [{1,1}, {last,last}]   (or just [{1,1}] when last == 1)
//   'all' <= REPLY_CAP  -> [{1,totalPages}], complete
//   'all' >  REPLY_CAP  -> [{1, capPages}, {last-capPages+1, last}]
//                          where capPages = REPLY_CAP_HALF / pageSize rounded
//                          so each side is ~REPLY_CAP_HALF rows at the manifest
//                          pageSize.
//
// The cap is on actual reply count (matches the DAO REPLY_CAP in sync.ts, which
// also gates on the real count), so a thread near the 1000 boundary does not
// split early just because totalPages*pageSize over-estimates the count.
import type { CachedRange, ReplyCacheManifestRow } from './types';
import type { OfflineReplyDepth } from './prefs';

// Must mirror src/lib/server/db/dao/sync.ts REPLY_CAP / REPLY_CAP_HALF. Kept
// local so the client manifest logic doesn't import server-only code; a
// future change in either constant must update both.
const REPLY_CAP = 1000;
const REPLY_CAP_HALF = 250;

/**
 * Shared totalPages derivation. The OP (earliest reply) renders as a special
 * top-of-thread block and is NOT part of the paginated reply stream, so a
 * thread with `commentCount` rows has only `max(0, commentCount-1)` paginated
 * replies. Every consumer that derives totalPages from commentCount must route
 * through this helper to avoid off-by-ones (RV07 C04 r2 audit A3-1).
 *
 * `Math.ceil(1)` for the degenerate 0/1-row case so a thread with only an OP
 * still reports 1 page (the orchestrator's depth 'first' writes [1,1]).
 */
export function computeTotalPages(commentCount: number, pageSize: number): number {
	if (pageSize <= 0) return 1;
	const nonOpCount = Math.max(0, Math.floor(commentCount) - 1);
	return Math.max(1, Math.ceil(nonOpCount / pageSize));
}

export interface ReplyGap {
	start: number;
	end: number;
	pageCount: number;
}

export interface ReplyGapSummary {
	gaps: ReplyGap[];
	totalMissingPages: number;
	// Missing replies (approx): sum of gap page counts * pageSize, capped at
	// commentCount so a stale totalPages never reports more than the thread has.
	totalMissingReplies: number;
	// Echoed from the manifest so the renderer can map each cached reply's
	// position to a page number when placing gap dividers. 0 when there is no
	// manifest (the no-gaps early return).
	pageSize: number;
	// Total pages in the thread (ceil(commentCount / pageSize), clamped >=1).
	// Lets the renderer compute proportional divider positions without
	// re-deriving from commentCount. 0 when there is no manifest.
	totalPages: number;
	// The cached ranges the manifest holds (normalized copy). Lets the
	// renderer allocate visible replies to blocks and place dividers at exact
	// block boundaries. Empty when there is no manifest.
	cachedRanges: CachedRange[];
}

/**
 * Derive the inclusive page ranges the cache should hold for a depth policy.
 *
 * For depth 'all' the over-cap decision is gated on the REAL commentCount
 * (not totalPages*pageSize), so a thread that fits within REPLY_CAP stays
 * complete even when totalPages*pageSize over-estimates near the boundary.
 */
export function computeCachedRanges(
	depth: OfflineReplyDepth,
	totalPages: number,
	pageSize: number,
	commentCount: number
): CachedRange[] {
	if (totalPages <= 0 || pageSize <= 0) return [];
	if (totalPages === 1) return [{ start: 1, end: 1 }];
	if (depth === 'first') return [{ start: 1, end: 1 }];
	if (depth === 'firstLast') {
		return [
			{ start: 1, end: 1 },
			{ start: totalPages, end: totalPages }
		];
	}
	// depth === 'all'. Cap on actual rows (matches the DAO REPLY_CAP in
	// sync.ts): each side holds at most REPLY_CAP_HALF replies ⇒ ceil / floor
	// pages at the manifest pageSize. Using commentCount (not the
	// totalPages*pageSize over-estimate) avoids phantom splits just below the
	// boundary - e.g. a 951-reply thread on pageSize 50 rounds up to 20 pages
	// (=1000 with the over-estimate) but really fits under the cap.
	if (commentCount <= REPLY_CAP) return [{ start: 1, end: totalPages }];
	const capPages = Math.max(1, Math.ceil(REPLY_CAP_HALF / pageSize));
	const firstEnd = Math.min(capPages, totalPages);
	const lastStart = Math.max(firstEnd + 1, totalPages - capPages + 1);
	if (lastStart > totalPages) return [{ start: 1, end: totalPages }];
	// If the two windows overlap or meet, merge into a single complete range.
	if (lastStart <= firstEnd + 1) return [{ start: 1, end: totalPages }];
	return [
		{ start: 1, end: firstEnd },
		{ start: lastStart, end: totalPages }
	];
}

/**
 * The highest page number the user has cached content for. The offline reader
 * at /offline/[discussionId] renders every cached reply in a single stream
 * (OP + all cached pages with gap dividers between non-contiguous blocks), so
 * a visit means the user has effectively read every cached page. Stamping
 * this value as `lastReadPage` on the read-state outbox row keeps the server's
 * `discussion_reads.lastReadPage` aligned with the page the user actually saw.
 * Defaults to 1 when there are no cached ranges (no manifest yet) so a fresh
 * row still records a valid page number.
 */
export function highestCachedPage(ranges: CachedRange[]): number {
	let max = 0;
	for (const r of ranges) {
		if (Number.isFinite(r.end) && r.end > max) max = r.end;
	}
	return Math.max(1, max);
}

/** True iff every page [1,totalPages] is covered by the cached ranges. */
export function isComplete(ranges: CachedRange[], totalPages: number): boolean {
	if (totalPages <= 0) return true;
	if (ranges.length === 0) return false;
	let covered = 0;
	for (const r of ranges) {
		if (r.start < 1 || r.end < r.start || r.end > totalPages) return false;
		covered += r.end - r.start + 1;
	}
	return covered === totalPages;
}

// Build a sorted, clamped copy of ranges so the gap scan below behaves even if
// the stored manifest was written out of order or overlaps itself.
function normalizeRanges(ranges: CachedRange[]): CachedRange[] {
	return ranges
		.filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end >= r.start)
		.map((r) => ({ start: Math.max(1, Math.floor(r.start)), end: Math.floor(r.end) }))
		.sort((a, b) => a.start - b.start);
}

/**
 * Compute the page-ranges missing from a cached manifest vs the thread total.
 * Returns the gaps (inclusive page numbers) plus the page/reply counts the
 * reader can render in its "N more not cached" divider.
 */
export function computeReplyGaps(
	manifest: ReplyCacheManifestRow | undefined,
	commentCount: number
): ReplyGapSummary {
	if (!manifest || manifest.totalPages <= 0 || manifest.pageSize <= 0) {
		return {
			gaps: [],
			totalMissingPages: 0,
			totalMissingReplies: 0,
			pageSize: 0,
			totalPages: 0,
			cachedRanges: []
		};
	}
	const ranges = normalizeRanges(manifest.cachedRanges);
	const gaps: ReplyGap[] = [];
	let cursor = 1;
	for (const r of ranges) {
		if (r.start > cursor) {
			gaps.push({ start: cursor, end: r.start - 1, pageCount: r.start - cursor });
		}
		cursor = Math.max(cursor, r.end + 1);
	}
	if (cursor <= manifest.totalPages) {
		gaps.push({
			start: cursor,
			end: manifest.totalPages,
			pageCount: manifest.totalPages - cursor + 1
		});
	}
	const totalMissingPages = gaps.reduce((acc, g) => acc + g.pageCount, 0);
	const rawMissingReplies = totalMissingPages * manifest.pageSize;
	const totalMissingReplies = Math.min(rawMissingReplies, Math.max(0, commentCount));
	return {
		gaps,
		totalMissingPages,
		totalMissingReplies,
		pageSize: manifest.pageSize,
		totalPages: manifest.totalPages,
		cachedRanges: ranges
	};
}
