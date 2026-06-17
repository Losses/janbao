import { discussions, replies, bookmarks, categories } from '../schema';
import { and, desc, eq, gt, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import type { D1Db } from '../index';
import type { SyncDiscussionDTO, SyncReplyDTO, SyncTombstoneDTO } from '$lib/types/api';

interface DeltaQuery {
	sinceTs: number;
	sinceId: number;
	limit: number;
}

function toSeconds(date: Date): number {
	return Math.floor(date.getTime() / 1000);
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
	return rows.map((r) => ({
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
	}));
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
	return rows.map((r) => ({
		id: r.id,
		discussionId: r.discussionId,
		authorId: r.authorId,
		contentJson: r.contentJson,
		createdAt: toSeconds(r.createdAt),
		updatedAt: toSeconds(r.updatedAt),
		editedAt: r.editedAt ? toSeconds(r.editedAt) : null,
		editedBy: r.editedBy
	}));
}

// Tombstones are scoped to the caller's readable categories so the sync stream
// can't leak the existence/deletion-timing of discussions in private categories.
export async function getDiscussionTombstones(
	db: D1Db,
	afterTs: number,
	limit: number,
	readableSlugs: string[]
): Promise<SyncTombstoneDTO[]> {
	if (readableSlugs.length === 0) return [];
	const rows = await db
		.select({ id: discussions.id, deletedAt: discussions.deletedAt })
		.from(discussions)
		.innerJoin(categories, eq(discussions.categorySlug, categories.slug))
		.where(
			and(
				isNotNull(discussions.deletedAt),
				gt(discussions.deletedAt, new Date(afterTs * 1000)),
				inArray(discussions.categorySlug, readableSlugs)
			)
		)
		.orderBy(discussions.deletedAt)
		.limit(limit);
	return rows.map((r) => ({ id: r.id, deletedAt: r.deletedAt ? toSeconds(r.deletedAt) : 0 }));
}

export async function getReplyTombstones(
	db: D1Db,
	afterTs: number,
	limit: number,
	readableSlugs: string[]
): Promise<SyncTombstoneDTO[]> {
	if (readableSlugs.length === 0) return [];
	const rows = await db
		.select({ id: replies.id, deletedAt: replies.deletedAt })
		.from(replies)
		.innerJoin(discussions, eq(replies.discussionId, discussions.id))
		.where(
			and(
				isNotNull(replies.deletedAt),
				gt(replies.deletedAt, new Date(afterTs * 1000)),
				inArray(discussions.categorySlug, readableSlugs)
			)
		)
		.orderBy(replies.deletedAt)
		.limit(limit);
	return rows.map((r) => ({ id: r.id, deletedAt: r.deletedAt ? toSeconds(r.deletedAt) : 0 }));
}

// Mirrors the live home-page ordering exactly (pinned first, then lastReplyAt
// desc) and is scoped to readable categories so eviction protects only what the
// user can actually see - no private-category id leak.
export async function getFrontPageDiscussionIds(
	db: D1Db,
	limit: number,
	readableSlugs: string[]
): Promise<number[]> {
	if (readableSlugs.length === 0) return [];
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
		.orderBy(desc(discussions.isPinned), desc(discussions.lastReplyAt))
		.limit(limit);
	return rows.map((r) => r.id);
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
