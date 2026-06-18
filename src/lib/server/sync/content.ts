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
	platformEnv: App.Platform['env'] | undefined;
}

export async function buildContentSync(input: ContentSyncInput): Promise<SyncContentResponse> {
	const nowSec = Math.floor(Date.now() / 1000);
	const lookback = nowSec - INITIAL_LOOKBACK_DAYS * DAY_SECONDS;

	const dCur = parseCursor(input.discussionsCursor, lookback);
	const rCur = parseCursor(input.repliesCursor, lookback);
	const dtCur = parseCursor(input.discussionTombstoneCursor, lookback);
	const rtCur = parseCursor(input.replyTombstoneCursor, lookback);

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
		getFrontPageDiscussionIds(input.db, getDiscussionsLimit(input.platformEnv), readableSlugs),
		getBookmarkedDiscussionIds(input.db, input.userId, readableSlugs)
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
	const newDTombCursor = lastDTomb
		? formatCursor(lastDTomb.deletedAt, lastDTomb.id)
		: (input.discussionTombstoneCursor ?? formatCursor(dtCur.ts, dtCur.id));
	const newRTombCursor = lastRTomb
		? formatCursor(lastRTomb.deletedAt, lastRTomb.id)
		: (input.replyTombstoneCursor ?? formatCursor(rtCur.ts, rtCur.id));

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
