// DV07 reply-cache manifest helpers. Pure functions over (depth, totalPages,
// pageSize) so they are unit-testable without a Dexie harness. Two layers:
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
// The cap is on rows, not pages (matches the DAO REPLY_CAP in sync.ts), so a
// different pageSize doesn't silently change the policy.
import type { CachedRange, ReplyCacheManifestRow } from './types';
import type { OfflineReplyDepth } from './prefs';

// Must mirror src/lib/server/db/dao/sync.ts REPLY_CAP / REPLY_CAP_HALF. Kept
// local so the client manifest logic doesn't import server-only code; a
// future change in either constant must update both.
const REPLY_CAP = 1000;
const REPLY_CAP_HALF = 250;

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
}

/** Derive the inclusive page ranges the cache should hold for a depth policy. */
export function computeCachedRanges(
	depth: OfflineReplyDepth,
	totalPages: number,
	pageSize: number
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
	// depth === 'all'. Cap on rows ⇒ each side holds at most REPLY_CAP_HALF
	// replies ⇒ ceil / floor pages at the manifest pageSize. The cap is on
	// actual reply count; without commentCount we approximate with
	// totalPages*pageSize (an over-estimate, so a thread near the boundary
	// may split early rather than miss the cap - the next sync rewrites the
	// manifest with the true commentCount via the orchestrator).
	const approxReplies = totalPages * pageSize;
	if (approxReplies <= REPLY_CAP) return [{ start: 1, end: totalPages }];
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
		return { gaps: [], totalMissingPages: 0, totalMissingReplies: 0 };
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
	return { gaps, totalMissingPages, totalMissingReplies };
}
