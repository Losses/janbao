// DV07 C04 r2 — pure helper for placing multi-range gap dividers in the
// offline reply stream (RV07-C04-Audit-01 A4-2). Lifted out of the
// /offline/[discussionId] renderer so the boundary math is unit-testable
// independent of the Svelte component.
//
// Model (clean, fixes the off-by-one the audit found):
//   - The OP (earliest reply) is a SPECIAL top-of-thread block, NOT part of
//     the paginated reply stream. It renders above all dividers and never
//     anchors a gap by itself.
//   - The paginated reply stream EXCLUDES the OP. The cached replies passed
//     here are the OP-excluding subset (the renderer splits the OP off first).
//   - A manifest `cachedRanges` entry is an inclusive page range in the
//     paginated stream. The replies that belong to range R are the cached
//     replies whose original page number falls in [R.start, R.end]. The
//     renderer does not know individual page numbers, but the manifest's
//     `cachedRanges` come back in ascending order, and a writer always cached
//     a CONTIGUOUS run for each range, so the cached replies partition across
//     ranges in order — count per range is derived from the gaps + total.
//
// The divider placement is computed as follows:
//   1. Walk each gap in ascending order. Each gap sits between two cached
//      ranges (or before the first, or after the last).
//   2. For each gap, compute how many cached replies precede it (= sum of
//      reply-counts of all ranges that come before the gap).
//   3. Emit a `GapPlacement` with `beforeIndex` = that cumulative count,
//      clamped to `cachedReplyCount`.
//
// `replyCountForRange` derives each range's reply count from the pageSize and
// the page count (end - start + 1). The OP is NOT subtracted from any range
// here — the caller already excluded the OP from the cached reply stream and
// from the cached ranges (the manifest model treats the OP as outside all
// pages).
//
// Special case (CO-C04-3): if the OP is cached but NO paginated ranges exist
// (cachedRanges empty) AND there are uncached pages, emit a single trailing
// `restNotCached` hint instead of an inline divider. The renderer renders it
// after the OP block. This keeps the "everything after the OP is uncached"
// state from rendering as a blank thread.

import type { CachedRange } from './types';
import type { ReplyGap } from './manifest';

export interface GapPlacement {
	gap: ReplyGap;
	// Render the divider BEFORE the cached reply at this index in the OP-
	// excluding reply stream. Always in [0, cachedReplyCount].
	beforeIndex: number;
	// Approximate reply count covered by this gap (pageCount * pageSize).
	// The renderer shows this in the divider label.
	approxReplies: number;
}

export interface GapPlacementInput {
	cachedRanges: CachedRange[];
	gaps: ReplyGap[];
	pageSize: number;
	totalPages: number;
	// Count of cached replies in the OP-excluding stream (i.e. the length of
	// the `rest` array the renderer iterates).
	cachedReplyCount: number;
}

export interface RestNotCachedHint {
	// Total uncached replies, clamped to a sane upper bound by the caller's
	// commentCount (the renderer clamps further at render time if needed).
	approxReplies: number;
	// Total uncached page count (the sum of all gap pageCounts).
	uncachedPages: number;
}

export interface GapPlacementResult {
	// Inline dividers to render before specific reply indices.
	placements: GapPlacement[];
	// When non-null, render a single "rest not cached" hint at the end (used
	// when no inline divider can be anchored — the OP-only case).
	restNotCached: RestNotCachedHint | null;
}

// Sum of reply counts across all cached ranges, derived purely from the
// ranges' page counts × pageSize. The renderer does NOT need to know which
// specific replies belong to which range — only how many precede each gap.
function totalCachedSlots(cachedRanges: CachedRange[], pageSize: number): number {
	let total = 0;
	for (const r of cachedRanges) {
		if (r.end < r.start) continue;
		total += (r.end - r.start + 1) * pageSize;
	}
	return total;
}

/**
 * Pure: compute where to render gap dividers in the cached reply stream.
 *
 * See module header for the full model. The placements are returned in
 * ascending `beforeIndex` order. `restNotCached` is non-null only in the
 * OP-only case (no cached ranges) where there is no inline divider to anchor.
 */
export function computeGapPlacements(input: GapPlacementInput): GapPlacementResult {
	const { cachedRanges, gaps, pageSize, totalPages, cachedReplyCount } = input;

	// OP-only case: no paginated ranges cached, but uncached pages exist.
	// Emit a single trailing hint (CO-C04-3).
	if (cachedRanges.length === 0) {
		if (gaps.length === 0 || totalPages <= 0) {
			return { placements: [], restNotCached: null };
		}
		const uncachedPages = gaps.reduce((acc, g) => acc + g.pageCount, 0);
		return {
			placements: [],
			restNotCached: {
				approxReplies: uncachedPages * pageSize,
				uncachedPages
			}
		};
	}

	if (gaps.length === 0) {
		return { placements: [], restNotCached: null };
	}

	// Build a map from page number -> index of the cached range that contains
	// it. This lets us figure out, for each gap, the cumulative count of cached
	// replies that precede it (= sum of pages-before-the-gap × pageSize).
	//
	// Because `gaps` and `cachedRanges` together fully partition [1, totalPages]
	// (the manifest-recompute coalescer guarantees this for valid manifests),
	// we can scan them in page order: replies-before-gap-N = sum of pages in
	// all ranges whose end < gap.start.
	const placements: GapPlacement[] = [];
	for (const gap of gaps) {
		let pagesBefore = 0;
		for (const r of cachedRanges) {
			if (r.end < gap.start) {
				pagesBefore += Math.max(0, r.end - r.start + 1);
			}
		}
		const beforeIndex = Math.min(pagesBefore * pageSize, Math.max(0, cachedReplyCount));
		// Skip a divider that would land at index 0 with no cached replies
		// before it AND no replies to render after it (avoids a leading divider
		// in an empty stream — the OP-only path already covers that case).
		placements.push({
			gap,
			beforeIndex,
			approxReplies: gap.pageCount * pageSize
		});
	}

	// Sanity: if cachedRanges has slots but cachedReplyCount is 0 (replies
	// evicted between manifest write and this read), suppress placements —
	// there is nothing to anchor dividers to, fall back to restNotCached.
	const totalSlots = totalCachedSlots(cachedRanges, pageSize);
	if (totalSlots > 0 && cachedReplyCount === 0 && placements.length > 0) {
		const uncachedPages = gaps.reduce((acc, g) => acc + g.pageCount, 0);
		return {
			placements: [],
			restNotCached: {
				approxReplies: uncachedPages * pageSize,
				uncachedPages
			}
		};
	}

	return { placements, restNotCached: null };
}
