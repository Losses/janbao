import type { D1Db } from '../db/index';
import {
	getActivitiesLimit,
	getDiscussionsLimit,
	getOfflineRetentionDays,
	getPaginationLimit,
	getReadableCategorySlugs
} from '../constants';
import {
	getBookmarkedDiscussionIds,
	getCachedUsers,
	getCuratedDiscussionIds,
	getDeltaDiscussions,
	getDeltaReplies,
	getDiscussionsByIds,
	getDiscussionTombstones,
	getFirstPageActivities,
	getFrontPageDiscussionIds,
	getRepliesForDepth,
	getReplyTombstones
} from '../db/dao/sync';
import type { DiscussionSort } from '../db/dao/discussions';
import type { ReplyBackfillDepth } from '../db/dao/sync';
import type { CuratedDiscussionIdSets, SyncContentResponse } from '$lib/types/api';

interface CursorParts {
	ts: number;
	id: number;
}

// All four streams use the same compound "<seconds>:<id>" high-water-mark cursor
// so a same-second tie group at a page boundary can't drop rows (the id
// tiebreaker is monotonic). On the first sync (no cursor) every stream looks back
// INITIAL_LOOKBACK_DAYS so initial population isn't a full history scan.
const INITIAL_LOOKBACK_DAYS = 30;

const DAY_SECONDS = 86400;

function parseCursor(cursor: string | undefined, fallbackTs: number): CursorParts {
	if (!cursor) return { ts: fallbackTs, id: 0 };
	const [ts, id] = cursor.split(':');
	const tsNum = Number(ts);
	const idNum = Number(id);
	if (!Number.isFinite(tsNum) || !Number.isFinite(idNum)) return { ts: fallbackTs, id: 0 };
	return { ts: tsNum, id: idNum };
}

function formatCursor(ts: number, id: number): string {
	return `${ts}:${id}`;
}

interface ContentSyncInput {
	db: D1Db;
	groupSlug: string;
	userId: number;
	discussionsCursor?: string;
	repliesCursor?: string;
	discussionTombstoneCursor?: string;
	replyTombstoneCursor?: string;
	limit: number;
	// DV07: curated categories to fetch page-1 id sets for (subset of the
	// DiscussionSort union). Empty = no curated sets returned (DV06 shape).
	curatedCategories: CuratedCategorySet[];
	// DV07: reply backfill depth for the curated + front/bookmark union.
	depth: ReplyDepth;
	platformEnv: App.Platform['env'] | undefined;
}

// Parameter types the route handler validates against. Kept here (not in
// $lib/types/api) because they are request-shape concerns, not response DTOs;
// the route re-exports them so callers share one canonical source.
export type CuratedCategorySet = DiscussionSort;
export type ReplyDepth = ReplyBackfillDepth;

// Parse `?categories=latest,mostViewed` into a de-duplicated subset of the
// allowlist. Unknown tokens are silently dropped (the spec only names three
// valid categories); the empty string yields [] which preserves the DV06 wire
// shape (no curatedDiscussionIds keys beyond what was requested).
export function parseCuratedCategories(
	raw: string,
	allowlist: readonly CuratedCategorySet[]
): CuratedCategorySet[] {
	const seen = new Set<CuratedCategorySet>();
	for (const token of raw.split(',')) {
		const trimmed = token.trim();
		if (!trimmed) continue;
		if ((allowlist as readonly string[]).includes(trimmed)) {
			seen.add(trimmed as CuratedCategorySet);
		}
	}
	return Array.from(seen);
}

export async function buildContentSync(input: ContentSyncInput): Promise<SyncContentResponse> {
	const nowSec = Math.floor(Date.now() / 1000);
	const lookback = nowSec - INITIAL_LOOKBACK_DAYS * DAY_SECONDS;

	const dCur = parseCursor(input.discussionsCursor, lookback);
	const rCur = parseCursor(input.repliesCursor, lookback);
	const dtCur = parseCursor(input.discussionTombstoneCursor, lookback);
	const rtCur = parseCursor(input.replyTombstoneCursor, lookback);

	const readableSlugs = await getReadableCategorySlugs(input.db, input.groupSlug);

	// Fetch curated page-1 id sets in parallel with the existing streams. The
	// curated queries use the same pageSize as the homepage (DISCUSSIONS_LIMIT)
	// so a curated category page mirrors what an online user would see.
	const discussionsListLimit = getDiscussionsLimit(input.platformEnv);
	const curatedFetches = input.curatedCategories.map((sort) =>
		getCuratedDiscussionIds(input.db, sort, discussionsListLimit, readableSlugs).then(
			(ids) => [sort, ids] as const
		)
	);

	const [disc, rep, dTomb, rTomb, front, bkm, activities, curatedResults] = await Promise.all([
		getDeltaDiscussions(
			input.db,
			{ sinceTs: dCur.ts, sinceId: dCur.id, limit: input.limit },
			readableSlugs
		),
		getDeltaReplies(
			input.db,
			{ sinceTs: rCur.ts, sinceId: rCur.id, limit: input.limit },
			readableSlugs
		),
		getDiscussionTombstones(
			input.db,
			{ sinceTs: dtCur.ts, sinceId: dtCur.id, limit: input.limit },
			readableSlugs
		),
		getReplyTombstones(
			input.db,
			{ sinceTs: rtCur.ts, sinceId: rtCur.id, limit: input.limit },
			readableSlugs
		),
		getFrontPageDiscussionIds(input.db, discussionsListLimit, readableSlugs),
		getBookmarkedDiscussionIds(input.db, input.userId, readableSlugs),
		getFirstPageActivities(input.db, getActivitiesLimit(input.platformEnv)),
		Promise.all(curatedFetches)
	]);

	const curatedDiscussionIds: CuratedDiscussionIdSets = {};
	for (const [sort, ids] of curatedResults) {
		curatedDiscussionIds[sort] = ids;
	}

	// Backfill detail + depth-aware replies for the UNION of curated + front +
	// bookmark discussion ids, bypassing the 30-day lookback. The depth policy
	// (decision #3) is applied once across the whole union so a thread cached
	// under multiple reasons isn't fetched twice.
	const replyPageSize = getPaginationLimit(input.platformEnv);
	const curatedFlat = Object.values(curatedDiscussionIds).flat();
	const endpointIds = Array.from(new Set([...curatedFlat, ...front, ...bkm]));
	const [backfillDiscussions, backfillReplies] = await Promise.all([
		getDiscussionsByIds(input.db, endpointIds, readableSlugs),
		getRepliesForDepth(input.db, endpointIds, input.depth, replyPageSize, readableSlugs)
	]);

	const lastDisc = disc[disc.length - 1];
	const lastRep = rep[rep.length - 1];
	const lastDTomb = dTomb[dTomb.length - 1];
	const lastRTomb = rTomb[rTomb.length - 1];

	// Author display info for every discussion + reply on this page. Fetched
	// after the content streams so we batch one query over the union of ids;
	// tombstones carry no author surface so they are excluded.
	const authorIds = [
		...disc.map((d) => d.authorId),
		...backfillDiscussions.map((d) => d.authorId),
		...rep.map((r) => r.authorId),
		...rep.flatMap((r) => (r.editedBy != null ? [r.editedBy] : [])),
		...backfillReplies.replies.flatMap((r) => [
			r.authorId,
			...(r.editedBy != null ? [r.editedBy] : [])
		]),
		...activities.flatMap((a) => [a.authorId, ...(a.recipientId != null ? [a.recipientId] : [])])
	];
	const cachedUsers = await getCachedUsers(input.db, authorIds);

	// Advance each cursor only to the last item actually returned; an empty page
	// leaves the cursor unchanged so the client stops paging that stream.
	const newDiscCursor = lastDisc
		? formatCursor(lastDisc.updatedAt, lastDisc.id)
		: (input.discussionsCursor ?? formatCursor(dCur.ts, dCur.id));
	const newRepCursor = lastRep
		? formatCursor(lastRep.updatedAt, lastRep.id)
		: (input.repliesCursor ?? formatCursor(rCur.ts, rCur.id));
	const newDTombCursor = lastDTomb
		? formatCursor(lastDTomb.deletedAt, lastDTomb.id)
		: (input.discussionTombstoneCursor ?? formatCursor(dtCur.ts, dtCur.id));
	const newRTombCursor = lastRTomb
		? formatCursor(lastRTomb.deletedAt, lastRTomb.id)
		: (input.replyTombstoneCursor ?? formatCursor(rtCur.ts, rtCur.id));

	return {
		discussions: [...disc, ...backfillDiscussions],
		replies: rep,
		backfillReplies: backfillReplies.replies,
		partialReplyDiscussionIds: backfillReplies.partialDiscussionIds,
		activities,
		replyPageSize,
		users: cachedUsers,
		discussionTombstones: dTomb,
		replyTombstones: rTomb,
		frontPageDiscussionIds: front,
		bookmarkedDiscussionIds: bkm,
		curatedDiscussionIds,
		cursors: {
			discussions: newDiscCursor,
			replies: newRepCursor,
			discussionTombstoneCursor: newDTombCursor,
			replyTombstoneCursor: newRTombCursor
		},
		hasMore: {
			discussions: disc.length >= input.limit,
			replies: rep.length >= input.limit,
			tombstones: dTomb.length >= input.limit || rTomb.length >= input.limit
		},
		serverTimeSeconds: nowSec,
		retentionDays: getOfflineRetentionDays(input.platformEnv)
	};
}
