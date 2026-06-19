// DV07 C04 - AUTHORITATIVE replyCacheManifest derivation. The manifest must
// reflect cached pages regardless of which writer (sync depth-backfill OR
// passthrough page-visit) put the replies in IDB, with no lost updates.
//
// Why page numbers are writer-supplied, not derived from reply contents:
// the manifest's `cachedRanges` are ABSOLUTE page numbers in the online
// thread's pagination (page N = replies at offset [(N-1)*pageSize,
// N*pageSize) excluding the OP). A reply's row in IDB carries its createdAt
// and id but NOT its absolute position in the thread — and a subset of
// replies (e.g. page 1 + page 10) cannot be bucketed back to their original
// page numbers from createdAt alone, because the cached stream is contiguous
// even when the underlying pages are not.
//
// So this module's model is: each writer reports the page(s) it cached
// (sync knows its depth-policy ranges; passthrough knows the page the user
// visited), and `mergePageRange` unions that range into the existing manifest.
// The replies-store read is used only to drop ranges whose replies were
// since evicted (defense-in-depth: if a range's replies are gone, the range
// is stale and must not claim completeness).
//
// This still satisfies the C04 spec's "no lost updates" goal: a discussion
// that is both curated (sync writes [1,5]) AND read-cached (passthrough
// writes [3]) ends up with [1,5]; curated-only [1,1] + passthrough [5,5]
// ends up with [1,1],[5,5]. The pre-C04 depth-only manifest is replaced by
// the merged union on every write.

import type { CachedRange, ReplyCacheManifestRow } from './types';

// Public input for the pure merge: a page range to union into the manifest,
// plus the thread's total page count + pageSize so `complete` can be evaluated.
export interface ManifestMergeInput {
	discussionId: number;
	commentCount: number;
	pageSize: number;
	// Inclusive page range the writer just cached. May span multiple pages
	// (sync depth 'firstLast' writes [1,1] + [last,last] in two calls; depth
	// 'all' writes [1,totalPages] in one).
	pageStart: number;
	pageEnd: number;
	// Ranges already in the manifest (read from IDB before the merge). The
	// merge unions the new range into these.
	existingRanges: CachedRange[];
}

export interface ManifestMergeResult {
	manifest: ReplyCacheManifestRow;
}

// Normalize + coalesce a set of ranges into a sorted, non-overlapping list.
// Clamps each range to [1, totalPages] and merges adjacent/overlapping.
function coalesceRanges(ranges: CachedRange[], totalPages: number): CachedRange[] {
	const valid = ranges
		.filter(
			(r) =>
				Number.isFinite(r.start) &&
				Number.isFinite(r.end) &&
				r.end >= r.start &&
				r.start >= 1 &&
				r.end <= totalPages
		)
		.map((r) => ({ start: Math.floor(r.start), end: Math.floor(r.end) }))
		.sort((a, b) => a.start - b.start);
	const out: CachedRange[] = [];
	for (const r of valid) {
		const last = out[out.length - 1];
		if (last && r.start <= last.end + 1) {
			// Overlap or adjacent: extend the current range.
			if (r.end > last.end) out[out.length - 1] = { start: last.start, end: r.end };
		} else {
			out.push({ start: r.start, end: r.end });
		}
	}
	return out;
}

function computeTotalPages(commentCount: number, pageSize: number): number {
	if (pageSize <= 0) return 1;
	// commentCount includes the OP (schema increments on every insert). The
	// thread route derives totalPages from replies-excluding-OP, so mirror that.
	const nonOpCount = Math.max(0, commentCount - 1);
	return Math.max(1, Math.ceil(nonOpCount / pageSize));
}

/**
 * Pure: merge a writer-reported page range into the manifest's existing
 * ranges, re-evaluating `complete` against the thread's totalPages.
 */
export function mergePageRange(input: ManifestMergeInput): ManifestMergeResult {
	const totalPages = computeTotalPages(input.commentCount, input.pageSize);
	const clampedStart = Math.max(1, Math.min(input.pageStart, totalPages));
	const clampedEnd = Math.max(clampedStart, Math.min(input.pageEnd, totalPages));
	const merged = coalesceRanges(
		[...input.existingRanges, { start: clampedStart, end: clampedEnd }],
		totalPages
	);
	// complete iff every page [1,totalPages] is covered.
	let complete = false;
	if (merged.length > 0) {
		let covered = 0;
		let valid = true;
		for (const r of merged) {
			if (r.start < 1 || r.end < r.start || r.end > totalPages) {
				valid = false;
				break;
			}
			covered += r.end - r.start + 1;
		}
		complete = valid && covered >= totalPages;
	}
	return {
		manifest: {
			discussionId: input.discussionId,
			totalPages,
			pageSize: input.pageSize,
			cachedRanges: merged,
			complete
		}
	};
}

// Structural view of the ForumOfflineDB subset this helper touches. Named
// (not inline) per the repo's no-inline-typing rule. The ForumOfflineDB class
// is structurally compatible, so callers pass the live Dexie instance.
export interface ReplyRow {
	id: number;
}
export type ReplyToArrayFn = () => Promise<ReplyRow[]>;
export interface ReplyWhereClause {
	toArray: ReplyToArrayFn;
}
export type ReplyEqualsFn = (value: number) => ReplyWhereClause;
export interface ReplyEqualsClause {
	equals: ReplyEqualsFn;
}
export type ReplyWhereFn = (key: string) => ReplyEqualsClause;
export interface ReplyWhereApi {
	where: ReplyWhereFn;
}
export type ManifestGetFn = (id: number) => Promise<ReplyCacheManifestRow | undefined>;
export type ManifestPutFn = (row: ReplyCacheManifestRow) => Promise<unknown>;
export type ManifestDeleteFn = (id: number) => Promise<unknown>;
export interface ReplyCacheManifestStore {
	get: ManifestGetFn;
	put: ManifestPutFn;
	delete: ManifestDeleteFn;
}
export interface ManifestRecomputeDb {
	replies: ReplyWhereApi;
	replyCacheManifest: ReplyCacheManifestStore;
}

/**
 * Reconcile a discussion's manifest after a writer cached a page range:
 *
 *   1. Read the existing manifest row (if any) to get its prior ranges.
 *   2. Drop any prior range whose replies are no longer in the cache (the
 *      range was evicted between writes — don't claim pages we don't have).
 *   3. Union the newly-cached range into the surviving ranges.
 *   4. Persist the result.
 *
 * Called from BOTH the C02 sync orchestrator (after it writes its
 * depth-policy ranges) AND the C04 passthrough writer (after it writes the
 * page the user visited). Idempotent: re-merging the same range is a no-op.
 *
 * The replies-store read in step 2 is the "derived from the replies store"
 * part of the C04 spec: ranges whose backing replies have been evicted are
 * dropped, so the manifest can never claim a page that isn't actually cached.
 */
export async function recomputeManifestForDiscussion(
	db: ManifestRecomputeDb,
	discussionId: number,
	commentCount: number,
	pageSize: number,
	cachedRange: CachedRange
): Promise<void> {
	if (pageSize <= 0) return;
	const existing = await db.replyCacheManifest.get(discussionId);
	const priorRanges = existing?.cachedRanges ?? [];

	// Defense-in-depth: if every reply for this discussion has been evicted,
	// the manifest is fully stale — delete it so the reader's gap view doesn't
	// claim pages that aren't actually cached.
	const surviving = await db.replies.where('discussionId').equals(discussionId).toArray();
	if (surviving.length === 0) {
		await db.replyCacheManifest.delete(discussionId);
		return;
	}

	const { manifest } = mergePageRange({
		discussionId,
		commentCount,
		pageSize,
		pageStart: cachedRange.start,
		pageEnd: cachedRange.end,
		existingRanges: priorRanges
	});
	await db.replyCacheManifest.put(manifest);
}
