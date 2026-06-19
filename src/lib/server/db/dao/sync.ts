import { activities, bookmarks, categories, discussions, replies, users } from '../schema';
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { D1Db } from '../index';
import type { DiscussionSort } from './discussions';
import type {
	SyncActivityDTO,
	SyncDiscussionDTO,
	SyncReplyDTO,
	SyncTombstoneDTO,
	SyncUserDTO
} from '$lib/types/api';

interface DeltaQuery {
	sinceTs: number;
	sinceId: number;
	limit: number;
}

function toSeconds(date: Date): number {
	return Math.floor(date.getTime() / 1000);
}

// Row shapes returned by the discussion / reply select statements, named so the
// DTO mappers stay reusable across the delta streams and the id-based backfill
// queries without duplicating the field mapping.
interface DiscussionSyncRow {
	id: number;
	title: string;
	slug: string;
	categorySlug: string;
	authorId: number;
	commentCount: number;
	isPinned: boolean;
	createdAt: Date;
	updatedAt: Date;
	lastReplyAt: Date | null;
}

interface ReplySyncRow {
	id: number;
	discussionId: number;
	authorId: number;
	contentJson: string;
	createdAt: Date;
	updatedAt: Date;
	editedAt: Date | null;
	editedBy: number | null;
}

function toDiscussionDTO(r: DiscussionSyncRow): SyncDiscussionDTO {
	return {
		id: r.id,
		title: r.title,
		slug: r.slug,
		categorySlug: r.categorySlug,
		authorId: r.authorId,
		commentCount: r.commentCount,
		isPinned: r.isPinned,
		createdAt: toSeconds(r.createdAt),
		updatedAt: toSeconds(r.updatedAt),
		lastReplyAt: r.lastReplyAt ? toSeconds(r.lastReplyAt) : null
	};
}

function toReplyDTO(r: ReplySyncRow): SyncReplyDTO {
	return {
		id: r.id,
		discussionId: r.discussionId,
		authorId: r.authorId,
		contentJson: r.contentJson,
		createdAt: toSeconds(r.createdAt),
		updatedAt: toSeconds(r.updatedAt),
		editedAt: r.editedAt ? toSeconds(r.editedAt) : null,
		editedBy: r.editedBy
	};
}

export async function getDeltaDiscussions(
	db: D1Db,
	query: DeltaQuery,
	readableSlugs: string[]
): Promise<SyncDiscussionDTO[]> {
	if (readableSlugs.length === 0) return [];
	// Cursor comparison: (updatedAt, id) strictly greater than (sinceTs, sinceId).
	// mode:'timestamp' columns store seconds, so a Date built from sinceTs*1000
	// encodes back to the same seconds for the comparison.
	const since = new Date(query.sinceTs * 1000);
	const rows = await db
		.select({
			id: discussions.id,
			title: discussions.title,
			slug: discussions.slug,
			categorySlug: discussions.categorySlug,
			authorId: discussions.authorId,
			commentCount: discussions.commentCount,
			isPinned: discussions.isPinned,
			createdAt: discussions.createdAt,
			updatedAt: discussions.updatedAt,
			lastReplyAt: discussions.lastReplyAt
		})
		.from(discussions)
		.where(
			and(
				isNull(discussions.deletedAt),
				inArray(discussions.categorySlug, readableSlugs),
				or(
					gt(discussions.updatedAt, since),
					and(eq(discussions.updatedAt, since), gt(discussions.id, query.sinceId))
				)
			)
		)
		.orderBy(discussions.updatedAt, discussions.id)
		.limit(query.limit);
	return rows.map(toDiscussionDTO);
}

export async function getDeltaReplies(
	db: D1Db,
	query: DeltaQuery,
	readableSlugs: string[]
): Promise<SyncReplyDTO[]> {
	if (readableSlugs.length === 0) return [];
	const since = new Date(query.sinceTs * 1000);
	const rows = await db
		.select({
			id: replies.id,
			discussionId: replies.discussionId,
			authorId: replies.authorId,
			contentJson: replies.contentJson,
			createdAt: replies.createdAt,
			updatedAt: replies.updatedAt,
			editedAt: replies.editedAt,
			editedBy: replies.editedBy
		})
		.from(replies)
		.innerJoin(discussions, eq(replies.discussionId, discussions.id))
		.where(
			and(
				isNull(replies.deletedAt),
				isNull(discussions.deletedAt),
				inArray(discussions.categorySlug, readableSlugs),
				or(
					gt(replies.updatedAt, since),
					and(eq(replies.updatedAt, since), gt(replies.id, query.sinceId))
				)
			)
		)
		.orderBy(replies.updatedAt, replies.id)
		.limit(query.limit);
	return rows.map(toReplyDTO);
}

// Tombstones use the same (deletedAt, id) compound cursor as the delta streams so
// a same-second delete tie group can't be dropped at a page boundary. Scoped to
// readable categories so the stream can't leak the existence/deletion-timing of
// discussions in private categories.
export async function getDiscussionTombstones(
	db: D1Db,
	query: DeltaQuery,
	readableSlugs: string[]
): Promise<SyncTombstoneDTO[]> {
	if (readableSlugs.length === 0) return [];
	const since = new Date(query.sinceTs * 1000);
	const rows = await db
		.select({ id: discussions.id, deletedAt: discussions.deletedAt })
		.from(discussions)
		.innerJoin(categories, eq(discussions.categorySlug, categories.slug))
		.where(
			and(
				isNotNull(discussions.deletedAt),
				inArray(discussions.categorySlug, readableSlugs),
				or(
					gt(discussions.deletedAt, since),
					and(eq(discussions.deletedAt, since), gt(discussions.id, query.sinceId))
				)
			)
		)
		.orderBy(discussions.deletedAt, discussions.id)
		.limit(query.limit);
	return rows.map((r) => ({ id: r.id, deletedAt: r.deletedAt ? toSeconds(r.deletedAt) : 0 }));
}

export async function getReplyTombstones(
	db: D1Db,
	query: DeltaQuery,
	readableSlugs: string[]
): Promise<SyncTombstoneDTO[]> {
	if (readableSlugs.length === 0) return [];
	const since = new Date(query.sinceTs * 1000);
	const rows = await db
		.select({ id: replies.id, deletedAt: replies.deletedAt })
		.from(replies)
		.innerJoin(discussions, eq(replies.discussionId, discussions.id))
		.where(
			and(
				isNotNull(replies.deletedAt),
				inArray(discussions.categorySlug, readableSlugs),
				or(
					gt(replies.deletedAt, since),
					and(eq(replies.deletedAt, since), gt(replies.id, query.sinceId))
				)
			)
		)
		.orderBy(replies.deletedAt, replies.id)
		.limit(query.limit);
	return rows.map((r) => ({ id: r.id, deletedAt: r.deletedAt ? toSeconds(r.deletedAt) : 0 }));
}

// Display info for every author referenced by the returned discussions +
// replies. Lets the offline reader render avatars and names without a second
// round-trip. An empty input returns [] without hitting the DB (inArray([])
// is rejected by drizzle), and a hard cap guards against pathological fan-out.
const MAX_USER_BATCH = 500;

export async function getCachedUsers(db: D1Db, userIds: number[]): Promise<SyncUserDTO[]> {
	const unique = Array.from(new Set(userIds)).filter((id) => Number.isFinite(id) && id > 0);
	if (unique.length === 0) return [];
	const capped = unique.slice(0, MAX_USER_BATCH);
	const rows = await db
		.select({
			id: users.id,
			displayName: users.displayName,
			username: users.username,
			avatarFileId: users.avatarFileId,
			avatarContentType: users.avatarContentType
		})
		.from(users)
		.where(inArray(users.id, capped));
	return rows;
}

// Page-1 discussion ids for a curated category (DV07). Mirrors the live homepage
// for `latest` (isPinned DESC, lastReplyAt DESC) and orders by the raw metric
// for the two curated sorts - no pinned promotion on metric sorts. Scoped to
// readable categories so eviction protects only what the user can see; no
// private-category id leak. Excludes soft-deleted discussions + disabled
// categories.
export async function getCuratedDiscussionIds(
	db: D1Db,
	sort: DiscussionSort,
	limit: number,
	readableSlugs: string[]
): Promise<number[]> {
	if (readableSlugs.length === 0) return [];
	// `latest` ends in lastReplyAt which can tie when two threads share a most
	// recent reply second → also add desc(id) so every sort is fully
	// deterministic and the curated page-1 ID set can't flap between syncs.
	const orderBy =
		sort === 'mostViewed'
			? [desc(discussions.viewCount), desc(discussions.id)]
			: sort === 'mostReplied'
				? [desc(discussions.commentCount), desc(discussions.id)]
				: [desc(discussions.isPinned), desc(discussions.lastReplyAt), desc(discussions.id)];
	const rows = await db
		.select({ id: discussions.id })
		.from(discussions)
		.innerJoin(categories, eq(discussions.categorySlug, categories.slug))
		.where(
			and(
				isNull(discussions.deletedAt),
				isNull(categories.disabledAt),
				inArray(discussions.categorySlug, readableSlugs)
			)
		)
		.orderBy(...orderBy)
		.limit(limit);
	return rows.map((r) => r.id);
}

// Mirrors the live home-page ordering exactly (pinned first, then lastReplyAt
// desc) and is scoped to readable categories so eviction protects only what the
// user can actually see - no private-category id leak.
export async function getFrontPageDiscussionIds(
	db: D1Db,
	limit: number,
	readableSlugs: string[]
): Promise<number[]> {
	return getCuratedDiscussionIds(db, 'latest', limit, readableSlugs);
}

export async function getBookmarkedDiscussionIds(
	db: D1Db,
	userId: number,
	readableSlugs: string[]
): Promise<number[]> {
	if (readableSlugs.length === 0) return [];
	const rows = await db
		.select({ discussionId: bookmarks.discussionId })
		.from(bookmarks)
		.innerJoin(discussions, eq(bookmarks.discussionId, discussions.id))
		.where(
			and(
				eq(bookmarks.userId, userId),
				isNull(discussions.deletedAt),
				inArray(discussions.categorySlug, readableSlugs)
			)
		);
	return rows.map((r) => r.discussionId);
}

// Force-include discussions by id, bypassing the 30-day lookback cursor. Used
// to backfill front-page + bookmarked discussions whose updatedAt predates the
// delta window - without this, a stale pinned post shows in the cached list
// (its id is in frontPageSnapshot) but /offline/[id] finds no detail row and
// reports "not cached".
export async function getDiscussionsByIds(
	db: D1Db,
	ids: number[],
	readableSlugs: string[]
): Promise<SyncDiscussionDTO[]> {
	if (ids.length === 0 || readableSlugs.length === 0) return [];
	const rows = await db
		.select({
			id: discussions.id,
			title: discussions.title,
			slug: discussions.slug,
			categorySlug: discussions.categorySlug,
			authorId: discussions.authorId,
			commentCount: discussions.commentCount,
			isPinned: discussions.isPinned,
			createdAt: discussions.createdAt,
			updatedAt: discussions.updatedAt,
			lastReplyAt: discussions.lastReplyAt
		})
		.from(discussions)
		.where(
			and(
				isNull(discussions.deletedAt),
				inArray(discussions.id, ids),
				inArray(discussions.categorySlug, readableSlugs)
			)
		);
	return rows.map(toDiscussionDTO);
}

interface ReplyEndpoints {
	replies: SyncReplyDTO[];
	partialDiscussionIds: number[];
}

// First + last page of replies per discussion, so the offline reader can render
// the OP + opening replies + the most recent replies even for old threads whose
// replies predate the 30-day lookback. A window-function subquery ranks rows
// within each discussion both ways; the outer filter keeps each head/tail page.
// partialDiscussionIds = discussions whose shipped reply set is genuinely
// incomplete vs the thread total - i.e. totalPages > 2 (first + last overlap or
// are adjacent ⇒ no middle gap ⇒ fully cached). Uses the stored commentCount to
// decide so it matches the reader's data-driven divider exactly.
export async function getReplyEndpointsFor(
	db: D1Db,
	discussionIds: number[],
	pageSize: number,
	readableSlugs: string[]
): Promise<ReplyEndpoints> {
	if (discussionIds.length === 0 || readableSlugs.length === 0)
		return { replies: [], partialDiscussionIds: [] };

	const ranked = db
		.select({
			id: replies.id,
			discussionId: replies.discussionId,
			authorId: replies.authorId,
			contentJson: replies.contentJson,
			createdAt: replies.createdAt,
			updatedAt: replies.updatedAt,
			editedAt: replies.editedAt,
			editedBy: replies.editedBy,
			rnAsc:
				sql<number>`ROW_NUMBER() OVER (PARTITION BY ${replies.discussionId} ORDER BY ${replies.createdAt}, ${replies.id})`.as(
					'rn_asc'
				),
			rnDesc:
				sql<number>`ROW_NUMBER() OVER (PARTITION BY ${replies.discussionId} ORDER BY ${replies.createdAt} DESC, ${replies.id} DESC)`.as(
					'rn_desc'
				)
		})
		.from(replies)
		.innerJoin(discussions, eq(replies.discussionId, discussions.id))
		.where(
			and(
				isNull(replies.deletedAt),
				isNull(discussions.deletedAt),
				inArray(replies.discussionId, discussionIds),
				inArray(discussions.categorySlug, readableSlugs)
			)
		)
		.as('ranked_replies');

	const rows = await db
		.select()
		.from(ranked)
		.where(or(lte(ranked.rnAsc, pageSize), lte(ranked.rnDesc, pageSize)));

	const shippedIds = new Set(rows.map((r) => r.discussionId));
	const countById = await getCountsById(db, [...shippedIds], readableSlugs);
	const partialDiscussionIds = [...shippedIds].filter((id) => {
		const total = countById.get(id) ?? 0;
		const totalPages = Math.ceil(total / pageSize);
		return totalPages > 2;
	});
	return { replies: rows.map(toReplyDTO), partialDiscussionIds };
}

// Reads the stored commentCount for the given discussion ids (scoped to readable
// categories), returning a Map keyed by discussion id. commentCount is the
// denormalized non-deleted reply count maintained on reply create/delete; it is
// the same number the reader uses to render its "N more not cached" divider, so
// the partial-discussion signal stays consistent with what the client displays.
async function getCountsById(
	db: D1Db,
	discussionIds: number[],
	readableSlugs: string[]
): Promise<Map<number, number>> {
	if (discussionIds.length === 0 || readableSlugs.length === 0) return new Map();
	const rows = await db
		.select({ id: discussions.id, commentCount: discussions.commentCount })
		.from(discussions)
		.where(
			and(
				isNull(discussions.deletedAt),
				inArray(discussions.id, discussionIds),
				inArray(discussions.categorySlug, readableSlugs)
			)
		);
	return new Map(rows.map((r) => [r.id, r.commentCount] as const));
}

// DV07 reply-cache depth policy (decision #3):
//   first     → page 1 only.
//   firstLast → page 1 + last page (same shape as getReplyEndpointsFor).
//   all       → if total replies ≤ REPLY_CAP (1000), every page; otherwise the
//               first CAP_HALF (250) + last CAP_HALF (250) replies (pages 1–5
//               and the last 5 at pageSize 50), leaving the middle as a gap the
//               client renders but does not fetch this cycle.
// The cap is on cached ROWS, not pages, so pageSize changes don't silently
// re-define the policy. Returns the actual reply rows (SyncReplyDTO shape) plus
// the discussions whose shipped reply set is genuinely incomplete vs total:
//   first     → total replies > pageSize (more than page 1 exists).
//   firstLast → handled by getReplyEndpointsFor (totalPages > 2).
//   all       → over-cap (> 1000 replies ⇒ first 250 + last 250, middle is a gap).
// Under-cap `all` threads are fully cached and NOT marked partial.
const REPLY_CAP = 1000;
const REPLY_CAP_HALF = 250;

export type ReplyBackfillDepth = 'first' | 'firstLast' | 'all';

interface DepthBackfill {
	replies: SyncReplyDTO[];
	partialDiscussionIds: number[];
}

export async function getRepliesForDepth(
	db: D1Db,
	discussionIds: number[],
	depth: ReplyBackfillDepth,
	pageSize: number,
	readableSlugs: string[]
): Promise<DepthBackfill> {
	if (discussionIds.length === 0 || readableSlugs.length === 0) {
		return { replies: [], partialDiscussionIds: [] };
	}

	// firstLast is the existing endpoint behavior; reuse it directly so the
	// offline cache stays byte-identical to DV06 for that depth.
	if (depth === 'firstLast') {
		const endpoints = await getReplyEndpointsFor(db, discussionIds, pageSize, readableSlugs);
		return {
			replies: endpoints.replies,
			partialDiscussionIds: endpoints.partialDiscussionIds
		};
	}

	const countById = await getCountsById(db, discussionIds, readableSlugs);
	const targetIds = countById.size === 0 ? [] : Array.from(countById.keys());

	if (targetIds.length === 0) {
		return { replies: [], partialDiscussionIds: [] };
	}

	// Cap policy (decision #3) applies per-thread via PARTITION BY in the window
	// function. For `all`, threads with ≤ REPLY_CAP replies keep every row;
	// threads with > REPLY_CAP additionally keep the first/last REPLY_CAP_HALF.
	const underCapIds = targetIds.filter((id) => (countById.get(id) ?? 0) <= REPLY_CAP);
	const overCapIds = targetIds.filter((id) => (countById.get(id) ?? 0) > REPLY_CAP);

	const ranked = db
		.select({
			id: replies.id,
			discussionId: replies.discussionId,
			authorId: replies.authorId,
			contentJson: replies.contentJson,
			createdAt: replies.createdAt,
			updatedAt: replies.updatedAt,
			editedAt: replies.editedAt,
			editedBy: replies.editedBy,
			rnAsc:
				sql<number>`ROW_NUMBER() OVER (PARTITION BY ${replies.discussionId} ORDER BY ${replies.createdAt}, ${replies.id})`.as(
					'rn_asc'
				),
			rnDesc:
				sql<number>`ROW_NUMBER() OVER (PARTITION BY ${replies.discussionId} ORDER BY ${replies.createdAt} DESC, ${replies.id} DESC)`.as(
					'rn_desc'
				)
		})
		.from(replies)
		.innerJoin(discussions, eq(replies.discussionId, discussions.id))
		.where(
			and(
				isNull(replies.deletedAt),
				isNull(discussions.deletedAt),
				inArray(replies.discussionId, targetIds),
				inArray(discussions.categorySlug, readableSlugs)
			)
		)
		.as('ranked_replies');

	// `first` keeps only page 1. `all` uses one unified filter: a thread with
	// ≤ REPLY_CAP replies has every row kept because both rnAsc and rnDesc stay
	// ≤ REPLY_CAP, but REPLY_CAP_HALF < REPLY_CAP would drop the middle - so
	// large threads are split out and UNIONed with the small-thread "all rows"
	// bucket. rnAsc / rnDesc are PARTITION BY discussionId, so each side counts
	// within its own thread.
	let rows: ReplySyncRow[];
	if (depth === 'first') {
		rows = await db.select().from(ranked).where(lte(ranked.rnAsc, pageSize));
	} else if (overCapIds.length === 0) {
		// No thread exceeds the cap - take every ranked row.
		rows = await db.select().from(ranked);
	} else {
		// Small threads: every row (rnAsc ≤ REPLY_CAP holds for all). Large
		// threads: first REPLY_CAP_HALF (rnAsc ≤ half) or last REPLY_CAP_HALF
		// (rnDesc ≤ half). Combine with OR; small threads' rows already satisfy
		// rnAsc ≤ REPLY_CAP, but we still need the half-clause for the large
		// threads, so the filter is the disjunction.
		const inSmall = inArray(ranked.discussionId, underCapIds);
		const inLarge = inArray(ranked.discussionId, overCapIds);
		const keepLarge = and(
			inLarge,
			or(lte(ranked.rnAsc, REPLY_CAP_HALF), lte(ranked.rnDesc, REPLY_CAP_HALF))
		);
		rows = await db.select().from(ranked).where(or(inSmall, keepLarge));
	}

	const partialDiscussionIds = partialForDepth(rows, depth, countById, pageSize);
	return { replies: rows.map(toReplyDTO), partialDiscussionIds };
}

// Computes the partial-discussion id set per depth, from the shipped rows + the
// stored commentCount map. An id appears only when the shipped reply set is
// genuinely incomplete vs the thread total (so `all` under-cap threads never
// appear, even though they went through the backfill path).
function partialForDepth(
	rows: ReplySyncRow[],
	depth: ReplyBackfillDepth,
	countById: Map<number, number>,
	pageSize: number
): number[] {
	if (depth === 'firstLast') return [];
	const shipped = new Set(rows.map((r) => r.discussionId));
	const result: number[] = [];
	for (const id of shipped) {
		const total = countById.get(id) ?? 0;
		const isPartial = depth === 'first' ? total > pageSize : depth === 'all' && total > REPLY_CAP;
		if (isPartial) result.push(id);
	}
	return result;
}

// First page of root activities (no parent) for the offline activity feed,
// mirroring the online activity load ordering. commentCount is computed per-row
// via a second grouped query (the activities table carries no denormalized
// count). joinedMembers / mentions are not synced - the offline feed degrades.
export async function getFirstPageActivities(db: D1Db, limit: number): Promise<SyncActivityDTO[]> {
	const rows = await db
		.select({
			id: activities.id,
			authorId: activities.authorId,
			recipientId: activities.recipientId,
			contentJson: activities.contentJson,
			createdAt: activities.createdAt,
			updatedAt: activities.updatedAt,
			isJoined: activities.isJoined
		})
		.from(activities)
		.where(and(isNull(activities.parentActivityId), isNull(activities.deletedAt)))
		.orderBy(
			sql`COALESCE(${activities.updatedAt}, ${activities.createdAt}) DESC`,
			desc(activities.id)
		)
		.limit(limit);

	if (rows.length === 0) return [];

	const counts = await db
		.select({
			parentActivityId: activities.parentActivityId,
			count: sql<number>`COUNT(*)`
		})
		.from(activities)
		.where(
			and(
				inArray(
					activities.parentActivityId,
					rows.map((r) => r.id)
				),
				isNull(activities.deletedAt)
			)
		)
		.groupBy(activities.parentActivityId);
	const countMap = new Map(counts.map((c) => [c.parentActivityId ?? 0, c.count] as const));

	return rows.map((r) => ({
		id: r.id,
		authorId: r.authorId,
		recipientId: r.recipientId,
		contentJson: r.contentJson,
		createdAt: toSeconds(r.createdAt),
		updatedAt: r.updatedAt ? toSeconds(r.updatedAt) : null,
		isJoined: r.isJoined,
		commentCount: countMap.get(r.id) ?? 0
	}));
}
