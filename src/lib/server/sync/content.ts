import type { D1Db } from '../db/index';
import {
	getDiscussionsLimit,
	getOfflineRetentionDays,
	getReadableCategorySlugs
} from '../constants';
import {
	getBookmarkedDiscussionIds,
	getDeltaDiscussions,
	getDeltaReplies,
	getDiscussionTombstones,
	getFrontPageDiscussionIds,
	getReplyTombstones
} from '../db/dao/sync';
import type { SyncContentResponse } from '$lib/types/api';

interface CursorParts {
	ts: number;
	id: number;
}

// Cursors are "<updatedAtSeconds>:<id>" high-water-marks. On the first sync (no
// cursor) we look back INITIAL_LOOKBACK_DAYS so the initial population isn't a full
// table scan of all history - subsequent syncs are strict deltas from the cursor.
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
	tombstoneAfter?: number;
	limit: number;
	platformEnv: App.Platform['env'] | undefined;
}

export async function buildContentSync(input: ContentSyncInput): Promise<SyncContentResponse> {
	const nowSec = Math.floor(Date.now() / 1000);
	const lookback = nowSec - INITIAL_LOOKBACK_DAYS * DAY_SECONDS;

	const dCur = parseCursor(input.discussionsCursor, lookback);
	const rCur = parseCursor(input.repliesCursor, lookback);
	const tAfter = input.tombstoneAfter ?? lookback;

	const readableSlugs = await getReadableCategorySlugs(input.db, input.groupSlug);

	const [disc, rep, dTomb, rTomb, front, bkm] = await Promise.all([
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
		getDiscussionTombstones(input.db, tAfter, input.limit),
		getReplyTombstones(input.db, tAfter, input.limit),
		getFrontPageDiscussionIds(input.db, getDiscussionsLimit(input.platformEnv)),
		getBookmarkedDiscussionIds(input.db, input.userId)
	]);

	const lastDisc = disc[disc.length - 1];
	const lastRep = rep[rep.length - 1];
	const lastDTomb = dTomb[dTomb.length - 1];
	const lastRTomb = rTomb[rTomb.length - 1];

	// Advance each cursor only to the last item actually returned; an empty page
	// leaves the cursor unchanged so the client stops paging that stream.
	const newDiscCursor = lastDisc
		? formatCursor(lastDisc.updatedAt, lastDisc.id)
		: (input.discussionsCursor ?? formatCursor(dCur.ts, dCur.id));
	const newRepCursor = lastRep
		? formatCursor(lastRep.updatedAt, lastRep.id)
		: (input.repliesCursor ?? formatCursor(rCur.ts, rCur.id));
	const newTombAfter = Math.max(
		tAfter,
		lastDTomb ? lastDTomb.deletedAt : 0,
		lastRTomb ? lastRTomb.deletedAt : 0
	);
	const tombstoneHasMore = dTomb.length >= input.limit || rTomb.length >= input.limit;

	return {
		discussions: disc,
		replies: rep,
		discussionTombstones: dTomb,
		replyTombstones: rTomb,
		frontPageDiscussionIds: front,
		bookmarkedDiscussionIds: bkm,
		cursors: {
			discussions: newDiscCursor,
			replies: newRepCursor,
			tombstoneAfter: newTombAfter
		},
		hasMore: {
			discussions: disc.length >= input.limit,
			replies: rep.length >= input.limit,
			tombstones: tombstoneHasMore
		},
		serverTimeSeconds: nowSec,
		retentionDays: getOfflineRetentionDays(input.platformEnv)
	};
}
