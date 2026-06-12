import { bookmarks, discussions, users, categories } from '../schema';
import { eq, and, isNull, desc, count } from 'drizzle-orm';
import type { D1Db } from '../index';
import type { BookmarkListItem, ListOffsetOptions } from '$lib/types/api';

/**
 * Fetch the active user's bookmarked discussions (excluding soft-deleted),
 * newest bookmark first. Shared by the /api/bookmarks endpoint and the
 * /bookmarks page loader.
 */
export async function getBookmarks(
	db: D1Db,
	userId: string,
	options: ListOffsetOptions
): Promise<BookmarkListItem[]> {
	const rows = await db
		.select({
			discussionId: bookmarks.discussionId,
			title: discussions.title,
			slug: discussions.slug,
			categorySlug: discussions.categorySlug,
			categoryTitle: categories.title,
			bookmarkedAt: bookmarks.bookmarkedAt,
			authorDisplayName: users.displayName
		})
		.from(bookmarks)
		.innerJoin(discussions, eq(bookmarks.discussionId, discussions.id))
		.innerJoin(categories, eq(discussions.categorySlug, categories.slug))
		.innerJoin(users, eq(discussions.authorId, users.id))
		.where(and(eq(bookmarks.userId, userId), isNull(discussions.deletedAt)))
		.orderBy(desc(bookmarks.bookmarkedAt))
		.limit(options.limit)
		.offset(options.offset);

	return rows.map((r) => ({
		discussionId: r.discussionId,
		title: r.title,
		slug: r.slug,
		categorySlug: r.categorySlug,
		categoryTitle: r.categoryTitle,
		authorDisplayName: r.authorDisplayName,
		bookmarkedAt: r.bookmarkedAt
	}));
}

/**
 * Total number of active discussions the user has bookmarked (for pagination).
 */
export async function getBookmarksCount(db: D1Db, userId: string): Promise<number> {
	const result = await db
		.select({ value: count() })
		.from(bookmarks)
		.innerJoin(discussions, eq(bookmarks.discussionId, discussions.id))
		.where(and(eq(bookmarks.userId, userId), isNull(discussions.deletedAt)));
	return result[0]?.value ?? 0;
}
