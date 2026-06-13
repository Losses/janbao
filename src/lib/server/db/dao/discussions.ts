import { discussions, users, bookmarks, discussionReads, replies, categories } from '../schema';
import { eq, and, isNull, desc, sql, count, inArray } from 'drizzle-orm';
import type { D1Db } from '../index';
import { getReadableCategorySlugs } from '$lib/server/constants';

export interface ReadHistory {
	lastReadAt: Date | null;
	lastReadPage: number;
	lastReadReplyId: number | null;
}

export interface DiscussionListItem {
	id: number;
	title: string;
	slug: string;
	categorySlug: string;
	categoryTitle?: string;
	authorId: number;
	authorDisplayName: string;
	authorUsername: string;
	authorAvatarFileId: string | null;
	viewCount: number;
	commentCount: number;
	isPinned: boolean;
	createdAt: Date;
	updatedAt: Date;
	isBookmarked: boolean;
	readHistory: ReadHistory | null;
	unreadCount: number;
	lastReplyAuthorDisplayName: string | null;
	lastReplyAuthorId: number | null;
	lastReplyAuthorUsername: string | null;
}

interface LastReplyAuthor {
	id: number;
	username: string;
	displayName: string;
}

interface GetDiscussionsListOptions {
	userId?: number | null;
	categorySlug?: string | null;
	authorId?: number | null;
	limit: number;
	offset: number;
	groupSlug?: string;
}

interface GetDiscussionsCountOptions {
	categorySlug?: string | null;
	authorId?: number | null;
	groupSlug?: string;
}

/**
 * Fetch a paginated list of discussions (Home, Category, or User discussions).
 *
 * Performance: Uses batch queries (2-3 total) instead of per-row queries (N+1).
 * - Main query: 1 query for paginated discussion rows with bookmark/read-join.
 * - Last reply author: 1 batch query across all discussionIds.
 * - Unread counts: 1 batch query per discussion the user has read, or uses commentCount.
 *
 * Security: When groupSlug is provided, only returns discussions from categories
 * the user/guest has read access to. This prevents permission leaks in list views.
 */
export async function getDiscussionsList(
	db: D1Db,
	options: GetDiscussionsListOptions
): Promise<DiscussionListItem[]> {
	const { userId, categorySlug, authorId, limit, offset, groupSlug } = options;

	// Build the select query
	const baseQuery = db
		.select({
			id: discussions.id,
			title: discussions.title,
			slug: discussions.slug,
			categorySlug: discussions.categorySlug,
			categoryTitle: categories.title,
			authorId: discussions.authorId,
			viewCount: discussions.viewCount,
			commentCount: discussions.commentCount,
			isPinned: discussions.isPinned,
			createdAt: discussions.createdAt,
			updatedAt: discussions.updatedAt,
			authorDisplayName: users.displayName,
			authorUsername: users.username,
			authorAvatarFileId: users.avatarFileId,
			// Left joins if userId is present
			isBookmarked: userId
				? sql<number>`CASE WHEN ${bookmarks.userId} IS NOT NULL THEN 1 ELSE 0 END`
				: sql<number>`0`,
			lastReadAt: userId ? discussionReads.lastReadAt : sql<null>`NULL`,
			lastReadPage: userId ? discussionReads.lastReadPage : sql<null>`NULL`,
			lastReadReplyId: userId ? discussionReads.lastReadReplyId : sql<null>`NULL`
		})
		.from(discussions)
		.innerJoin(users, eq(discussions.authorId, users.id))
		.innerJoin(categories, eq(discussions.categorySlug, categories.slug));

	// Apply left joins if userId is present
	if (userId) {
		baseQuery
			.leftJoin(
				bookmarks,
				and(eq(bookmarks.discussionId, discussions.id), eq(bookmarks.userId, userId))
			)
			.leftJoin(
				discussionReads,
				and(eq(discussionReads.discussionId, discussions.id), eq(discussionReads.userId, userId))
			);
	}

	// Apply where filters
	const whereClauses = [isNull(discussions.deletedAt)];
	if (categorySlug) {
		whereClauses.push(eq(discussions.categorySlug, categorySlug));
	}
	if (authorId) {
		whereClauses.push(eq(discussions.authorId, authorId));
	}

	baseQuery.where(and(...whereClauses));

	// Order: Pinned discussions first, then updatedAt descending
	baseQuery.orderBy(desc(discussions.isPinned), desc(discussions.updatedAt));

	baseQuery.limit(limit).offset(offset);

	let rows = await baseQuery;

	// Security: Filter out discussions from categories the user/guest cannot read
	if (groupSlug) {
		rows = await filterByCategoryReadAccess(db, rows, groupSlug);
	}

	if (rows.length === 0) {
		return [];
	}

	const discussionIds = rows.map((r) => r.id);

	// Batch query 1: For each discussion, find the latest reply's id via MAX(createdAt),
	// then join back to get the author's displayName.
	// This uses a self-join pattern on the replies table.
	const latestReplySubq = db
		.select({
			discussionId: replies.discussionId,
			maxCreatedAt: sql<Date>`MAX(${replies.createdAt})`.as('max_created_at')
		})
		.from(replies)
		.where(and(inArray(replies.discussionId, discussionIds), isNull(replies.deletedAt)))
		.groupBy(replies.discussionId)
		.as('latest_reply');

	const lastReplyAuthors = await db
		.select({
			discussionId: latestReplySubq.discussionId,
			authorId: users.id,
			authorUsername: users.username,
			authorDisplayName: users.displayName
		})
		.from(latestReplySubq)
		.innerJoin(
			replies,
			and(
				eq(replies.discussionId, latestReplySubq.discussionId),
				eq(replies.createdAt, latestReplySubq.maxCreatedAt),
				isNull(replies.deletedAt)
			)
		)
		.innerJoin(users, eq(replies.authorId, users.id));

	const lastReplyMap = new Map<number, LastReplyAuthor>();
	for (const row of lastReplyAuthors) {
		lastReplyMap.set(row.discussionId, {
			id: row.authorId,
			username: row.authorUsername,
			displayName: row.authorDisplayName
		});
	}

	// Batch query 2: Unread counts per discussion (only when userId present)
	// For discussions the user has read, count replies newer than lastReadAt.
	// For discussions the user has never read, use commentCount directly.
	const unreadMap = new Map<number, number>();
	if (userId) {
		// Separate into "read" and "unread" discussion sets
		const readDiscussions = rows.filter((r) => r.lastReadAt !== null);
		const unreadDiscussions = rows.filter((r) => r.lastReadAt === null);

		// Unread discussions: all replies are unread
		for (const row of unreadDiscussions) {
			unreadMap.set(row.id, row.commentCount);
		}

		// Read discussions: batch count replies newer than each discussion's lastReadAt
		// Since each discussion has a different lastReadAt timestamp, we run one query per
		// discussion but use IN(...) for the discussionIds to keep index lookups efficient.
		// This is a controlled pattern: max 20 queries, each hitting the composite index.
		const readIds = readDiscussions.map((r) => r.id);
		if (readIds.length > 0) {
			const readMap = new Map<number, Date>();
			for (const row of readDiscussions) {
				readMap.set(row.id, row.lastReadAt!);
			}

			// Fetch all non-deleted replies for these discussions created after their respective
			// lastReadAt. We use a union-like approach: fetch all replies for these discussions
			// and filter in-memory since each discussion has a different threshold.
			const allRecentReplies = await db
				.select({
					discussionId: replies.discussionId,
					createdAt: replies.createdAt
				})
				.from(replies)
				.where(and(inArray(replies.discussionId, readIds), isNull(replies.deletedAt)));

			for (const did of readIds) {
				const threshold = readMap.get(did)!;
				const cnt = allRecentReplies.filter(
					(r) => r.discussionId === did && r.createdAt > threshold
				).length;
				unreadMap.set(did, cnt);
			}
		}
	}

	return rows.map((row) => ({
		id: row.id,
		title: row.title,
		slug: row.slug,
		categorySlug: row.categorySlug,
		categoryTitle: row.categoryTitle,
		authorId: row.authorId,
		authorDisplayName: row.authorDisplayName,
		authorUsername: row.authorUsername,
		authorAvatarFileId: row.authorAvatarFileId,
		viewCount: row.viewCount,
		commentCount: row.commentCount,
		isPinned: row.isPinned,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		isBookmarked: row.isBookmarked === 1,
		readHistory: row.lastReadAt
			? {
					lastReadAt: row.lastReadAt,
					lastReadPage: row.lastReadPage || 1,
					lastReadReplyId: row.lastReadReplyId
				}
			: null,
		unreadCount: unreadMap.get(row.id) || 0,
		lastReplyAuthorDisplayName: lastReplyMap.get(row.id)?.displayName || null,
		lastReplyAuthorId: lastReplyMap.get(row.id)?.id || null,
		lastReplyAuthorUsername: lastReplyMap.get(row.id)?.username || null
	}));
}

/**
 * Get the total number of active discussions (for pagination).
 * When groupSlug is provided, only counts discussions from readable categories.
 */
export async function getDiscussionsCount(
	db: D1Db,
	options: GetDiscussionsCountOptions = {}
): Promise<number> {
	const { categorySlug, authorId, groupSlug } = options;

	const whereClauses = [isNull(discussions.deletedAt)];
	if (categorySlug) {
		whereClauses.push(eq(discussions.categorySlug, categorySlug));
	}
	if (authorId) {
		whereClauses.push(eq(discussions.authorId, authorId));
	}

	let res = await db
		.select({ count: count() })
		.from(discussions)
		.where(and(...whereClauses));

	// Security: If groupSlug provided and no explicit categorySlug filter, filter by readable categories
	if (groupSlug && !categorySlug) {
		const readableSlugs = await getReadableCategorySlugs(db, groupSlug);
		if (readableSlugs !== null) {
			// null means all categories are readable (privileged)
			res = await db
				.select({ count: count() })
				.from(discussions)
				.where(
					and(
						...whereClauses,
						readableSlugs.length > 0 ? inArray(discussions.categorySlug, readableSlugs) : sql`1 = 0`
					)
				);
		}
	}

	return res[0]?.count || 0;
}

/**
 * Post-query filter: remove rows from categories the user/guest cannot read.
 * Used when the main query can't easily JOIN on categoryPermissions.
 */
async function filterByCategoryReadAccess<T extends { categorySlug: string }>(
	db: D1Db,
	rows: T[],
	groupSlug: string
): Promise<T[]> {
	if (groupSlug === 'admin' || groupSlug === 'moderator') {
		return rows;
	}

	const readableSlugs = await getReadableCategorySlugs(db, groupSlug);
	if (readableSlugs === null) return rows; // all readable

	const readableSet = new Set(readableSlugs);
	return rows.filter((row) => readableSet.has(row.categorySlug));
}
