import { discussions, users, bookmarks, discussionReads, replies, categories } from '../schema';
import { eq, and, or, gt, isNull, desc, sql, count, inArray } from 'drizzle-orm';
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
	lastReplyAt: Date;
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

interface UnreadCountRow {
	discussionId: number;
	count: number;
}

// Curated category sort modes. `latest` mirrors the live homepage
// (isPinned DESC, lastReplyAt DESC); the two metric sorts order by the raw
// counter with no pinned promotion, matching the DV07 spec for the offline
// cache's curated category pages.
export type DiscussionSort = 'latest' | 'mostViewed' | 'mostReplied';

export interface GetDiscussionsListOptions {
	userId?: number | null;
	categorySlug?: string | null;
	authorId?: number | null;
	limit: number;
	offset: number;
	groupSlug?: string;
	// Defaults to 'latest' so every existing caller keeps current behavior.
	sort?: DiscussionSort;
	// Optional pre-resolved readable-category slug set. When provided, the list's
	// read-access post-filter reuses it instead of re-querying. Pass-through from
	// {@link loadDiscussionsPage} so the shared helper fetches slugs once for both
	// list and count. Omit to let the filter fetch it internally.
	readableSlugs?: string[];
}

interface GetDiscussionsCountOptions {
	categorySlug?: string | null;
	authorId?: number | null;
	groupSlug?: string;
	// Optional pre-resolved readable-category slug set; mirrors
	// {@link GetDiscussionsListOptions.readableSlugs} so the count can skip its
	// own getReadableCategorySlugs fetch when a caller already has the set.
	readableSlugs?: string[];
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
	const { userId, categorySlug, authorId, limit, offset, groupSlug, readableSlugs } = options;
	const sort: DiscussionSort = options.sort ?? 'latest';

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
			lastReplyAt: discussions.lastReplyAt,
			authorDisplayName: users.displayName,
			authorUsername: users.username,
			authorAvatarFileId: users.avatarFileId,
			// Left joins if userId is present
			isBookmarked:
				userId !== null && userId !== undefined
					? sql<number>`CASE WHEN ${bookmarks.userId} IS NOT NULL THEN 1 ELSE 0 END`
					: sql<number>`0`,
			lastReadAt:
				userId !== null && userId !== undefined ? discussionReads.lastReadAt : sql<null>`NULL`,
			lastReadPage:
				userId !== null && userId !== undefined ? discussionReads.lastReadPage : sql<null>`NULL`,
			lastReadReplyId:
				userId !== null && userId !== undefined ? discussionReads.lastReadReplyId : sql<null>`NULL`
		})
		.from(discussions)
		.innerJoin(users, eq(discussions.authorId, users.id))
		.innerJoin(categories, eq(discussions.categorySlug, categories.slug));

	// Apply left joins if userId is present
	if (userId !== null && userId !== undefined) {
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
	const whereClauses = [isNull(discussions.deletedAt), isNull(categories.disabledAt)];
	if (categorySlug) {
		whereClauses.push(eq(discussions.categorySlug, categorySlug));
	}
	if (authorId != null) {
		whereClauses.push(eq(discussions.authorId, authorId));
	}
	// Scope to categories the caller's group can read, server-side. This mirrors
	// getDiscussionsCount and replaces an older post-query JS filter that fetched
	// `limit` rows across ALL categories then discarded the unreadable ones - which
	// both over-fetched and caused pagination drift (list returned short pages
	// whenever the readable set was restricted). Resolving the slug set here when a
	// caller didn't pre-pass it keeps the direct-call path correct too.
	if (groupSlug) {
		const resolvedSlugs = readableSlugs ?? (await getReadableCategorySlugs(db, groupSlug));
		whereClauses.push(
			resolvedSlugs.length > 0 ? inArray(discussions.categorySlug, resolvedSlugs) : sql`1 = 0`
		);
	}

	baseQuery.where(and(...whereClauses));

	// Order: `latest` (default) mirrors the live homepage - pinned first, then
	// lastReplyAt descending (real time of the latest reply, not updatedAt which
	// pin/edit/delete also bump). The metric sorts order by the raw counter with
	// NO pinned promotion, matching the DV07 curated-category spec. Existing
	// callers omit `sort` and land on `latest`, preserving current behavior.
	if (sort === 'mostViewed') {
		baseQuery.orderBy(desc(discussions.viewCount), desc(discussions.id));
	} else if (sort === 'mostReplied') {
		baseQuery.orderBy(desc(discussions.commentCount), desc(discussions.id));
	} else {
		baseQuery.orderBy(
			desc(discussions.isPinned),
			desc(discussions.lastReplyAt),
			desc(discussions.id)
		);
	}

	baseQuery.limit(limit).offset(offset);

	const rows = await baseQuery;

	if (rows.length === 0) {
		return [];
	}

	// Two batch queries follow the main fetch, and neither depends on the other:
	//   1. latest-reply author per discussion (self-join on MAX(replies.createdAt))
	//   2. recent replies for read discussions, to derive per-discussion unread counts.
	// Kick both off together and await once, instead of two sequential round-trips.
	// Pre-compute the read/unread split so we know whether batch 2 is needed before
	// awaiting anything; unread-by-default discussions reuse commentCount below.
	const readDiscussions =
		userId !== null && userId !== undefined ? rows.filter((r) => r.lastReadAt !== null) : [];
	const readIds = readDiscussions.map((r) => r.id);

	const lastReplyAuthorsPromise = db
		.select({
			discussionId: replies.discussionId,
			authorId: users.id,
			authorUsername: users.username,
			authorDisplayName: users.displayName
		})
		.from(replies)
		.innerJoin(users, eq(replies.authorId, users.id))
		.where(
			or(
				...rows.map((r) =>
					and(
						eq(replies.discussionId, r.id),
						eq(replies.createdAt, r.lastReplyAt ?? r.createdAt),
						isNull(replies.deletedAt)
					)
				)
			)
		);

	// Only opened discussions need a fresh reply count; never-opened ones reuse
	// commentCount. Resolve to an empty array so the parallel await stays uniform.
	const unreadCountsPromise: Promise<UnreadCountRow[]> =
		readIds.length > 0
			? db
					.select({
						discussionId: replies.discussionId,
						count: count()
					})
					.from(replies)
					.where(
						or(
							...readDiscussions.map((d) => {
								if (d.lastReadReplyId !== null && d.lastReadReplyId !== undefined) {
									return and(
										eq(replies.discussionId, d.id),
										gt(replies.id, d.lastReadReplyId),
										isNull(replies.deletedAt)
									);
								} else {
									return and(
										eq(replies.discussionId, d.id),
										gt(replies.createdAt, d.lastReadAt!),
										isNull(replies.deletedAt)
									);
								}
							})
						)
					)
					.groupBy(replies.discussionId)
			: Promise.resolve([]);

	const [lastReplyAuthors, unreadCounts] = await Promise.all([
		lastReplyAuthorsPromise,
		unreadCountsPromise
	]);

	const lastReplyMap = new Map<number, LastReplyAuthor>();
	for (const row of lastReplyAuthors) {
		lastReplyMap.set(row.discussionId, {
			id: row.authorId,
			username: row.authorUsername,
			displayName: row.authorDisplayName
		});
	}

	const unreadMap = new Map<number, number>();
	if (userId !== null && userId !== undefined) {
		// Discussions the user has never opened: every reply counts as unread.
		for (const row of rows.filter((r) => r.lastReadAt === null)) {
			unreadMap.set(row.id, row.commentCount);
		}

		// Opened discussions: initialize to 0, then update with counts from database.
		for (const did of readIds) {
			unreadMap.set(did, 0);
		}
		for (const row of unreadCounts) {
			unreadMap.set(row.discussionId, row.count);
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
		// Column is nullable (SQLite ALTER TABLE limitation); backfill + every
		// insert set it, but coalesce to createdAt so the DTO stays non-null.
		lastReplyAt: row.lastReplyAt ?? row.createdAt,
		isBookmarked: row.isBookmarked === 1,
		readHistory: row.lastReadAt
			? {
					lastReadAt: row.lastReadAt,
					lastReadPage: row.lastReadPage || 1,
					lastReadReplyId: row.lastReadReplyId
				}
			: null,
		unreadCount: unreadMap.get(row.id) || 0,
		lastReplyAuthorDisplayName: lastReplyMap.get(row.id)?.displayName ?? null,
		lastReplyAuthorId: lastReplyMap.get(row.id)?.id ?? null,
		lastReplyAuthorUsername: lastReplyMap.get(row.id)?.username ?? null
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
	const { categorySlug, authorId, groupSlug, readableSlugs } = options;

	const whereClauses = [isNull(discussions.deletedAt), isNull(categories.disabledAt)];
	if (categorySlug) {
		whereClauses.push(eq(discussions.categorySlug, categorySlug));
	}
	if (authorId != null) {
		whereClauses.push(eq(discussions.authorId, authorId));
	}

	if (groupSlug && !categorySlug) {
		const resolvedSlugs = readableSlugs ?? (await getReadableCategorySlugs(db, groupSlug));
		whereClauses.push(
			resolvedSlugs.length > 0 ? inArray(discussions.categorySlug, resolvedSlugs) : sql`1 = 0`
		);
	}

	const res = await db
		.select({ count: count() })
		.from(discussions)
		.innerJoin(categories, eq(discussions.categorySlug, categories.slug))
		.where(and(...whereClauses));

	return res[0]?.count || 0;
}

interface DiscussionsPageResult {
	discussions: DiscussionListItem[];
	totalPages: number;
	totalCount: number;
}

/**
 * Shared page-load helper for discussion listings (home, /discussions, category).
 * Runs the list query + total count and derives totalPages so route loads stay
 * thin and free of duplicated query/count boilerplate. Reuses
 * {@link GetDiscussionsListOptions} so it also supports author filtering.
 */
export async function loadDiscussionsPage(
	db: D1Db,
	options: GetDiscussionsListOptions
): Promise<DiscussionsPageResult> {
	const { categorySlug, authorId, groupSlug, limit } = options;

	// Resolve the readable-category slug set once and share it between the list's
	// post-filter and the count query. getReadableCategorySlugs is two sequential
	// queries; computing it here avoids running that pair twice per page load.
	const readableSlugs = groupSlug ? await getReadableCategorySlugs(db, groupSlug) : undefined;

	// The list and the total count have no data dependency on each other, so run
	// them concurrently rather than awaiting one before starting the other.
	const [discussions, totalCount] = await Promise.all([
		getDiscussionsList(db, { ...options, readableSlugs }),
		getDiscussionsCount(db, { categorySlug, authorId, groupSlug, readableSlugs })
	]);
	const totalPages = Math.ceil(totalCount / limit);

	return { discussions, totalPages, totalCount };
}
