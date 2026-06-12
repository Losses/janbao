import { discussions, users, bookmarks, discussionReads, replies, categories } from '../schema';
import { eq, and, isNull, desc, sql, count } from 'drizzle-orm';
import type { D1Db } from '../index';

export interface DiscussionListItem {
	id: string;
	title: string;
	slug: string;
	categorySlug: string;
	categoryTitle?: string;
	authorId: string;
	authorDisplayName: string;
	authorUsername: string;
	authorAvatarFileId: string | null;
	viewCount: number;
	commentCount: number;
	isPinned: boolean;
	createdAt: Date;
	updatedAt: Date;
	isBookmarked: boolean;
	readHistory: {
		lastReadAt: Date | null;
		lastReadPage: number;
		lastReadReplyId: string | null;
	} | null;
	unreadCount: number;
	lastReplyAuthorDisplayName: string | null;
}

/**
 * Fetch a paginated list of discussions (Home, Category, or User discussions).
 */
export async function getDiscussionsList(
	db: D1Db,
	options: {
		userId?: string | null;
		categorySlug?: string | null;
		authorId?: string | null;
		limit: number;
		offset: number;
	}
): Promise<DiscussionListItem[]> {
	const { userId, categorySlug, authorId, limit, offset } = options;

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

	const rows = await baseQuery;

	const results: DiscussionListItem[] = [];

	// Fetch details for each discussion sequentially/concurrently
	for (const row of rows) {
		let unreadCount = 0;
		let lastReplyAuthorDisplayName: string | null = null;

		// 1. Calculate unreadCount if userId is set
		if (userId) {
			const lastReadVal = row.lastReadAt;
			if (lastReadVal) {
				const unreadRes = await db
					.select({ count: count() })
					.from(replies)
					.where(
						and(
							eq(replies.discussionId, row.id),
							sql`${replies.createdAt} > ${lastReadVal}`,
							isNull(replies.deletedAt)
						)
					);
				unreadCount = unreadRes[0]?.count || 0;
			} else {
				// User has never read it, count all replies
				unreadCount = row.commentCount;
			}
		}

		// 2. Fetch last reply author display name
		const lastReplyRes = await db
			.select({
				displayName: users.displayName
			})
			.from(replies)
			.innerJoin(users, eq(replies.authorId, users.id))
			.where(and(eq(replies.discussionId, row.id), isNull(replies.deletedAt)))
			.orderBy(desc(replies.createdAt))
			.limit(1);

		if (lastReplyRes.length > 0) {
			lastReplyAuthorDisplayName = lastReplyRes[0].displayName;
		}

		results.push({
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
			unreadCount,
			lastReplyAuthorDisplayName
		});
	}

	return results;
}

/**
 * Get the total number of active discussions (for pagination).
 */
export async function getDiscussionsCount(
	db: D1Db,
	options: {
		categorySlug?: string | null;
		authorId?: string | null;
	} = {}
): Promise<number> {
	const { categorySlug, authorId } = options;

	const whereClauses = [isNull(discussions.deletedAt)];
	if (categorySlug) {
		whereClauses.push(eq(discussions.categorySlug, categorySlug));
	}
	if (authorId) {
		whereClauses.push(eq(discussions.authorId, authorId));
	}

	const res = await db
		.select({ count: count() })
		.from(discussions)
		.where(and(...whereClauses));

	return res[0]?.count || 0;
}
