import { replies, discussions, activities, categoryPermissions, categories } from '../schema';
import { eq, and, isNull, isNotNull, sql } from 'drizzle-orm';
import type { D1Db } from '../index';

export interface UserCommentItem {
	id: string;
	kind: 'reply' | 'activity_comment';
	contentJson: string;
	createdAt: Date;
	discussionId: string | null;
	discussionTitle: string | null;
	discussionSlug: string | null;
	parentActivityId: string | null;
}

// Defensive cap bounding each leg of the UNION (spec §6.13 says "all"; this
// guards D1/worker memory for prolific authors without truncating normal use).
const COMMENT_LIST_LIMIT = 500;

/**
 * UNION-style merge of a user's discussion replies and activity comments,
 * sorted chronologically (newest first). Per RQ00-Backend §6.3, both datasets
 * are fetched independently and merged in memory, each carrying its context
 * indicator (discussion title for replies, parent activity id for comments).
 * Both legs exclude soft-deleted rows AND soft-deleted parents.
 *
 * Security: When groupSlug is provided, discussion replies are filtered to only
 * include those from categories the user/guest can read.
 */
export async function getUserComments(
	db: D1Db,
	userId: string,
	groupSlug?: string
): Promise<UserCommentItem[]> {
	// Determine readable category slugs if groupSlug provided
	let readableCategorySlugs: Set<string> | null = null;
	if (groupSlug && groupSlug !== 'admin' && groupSlug !== 'moderator') {
		const readableSlugs = await getReadableCategorySlugs(db, groupSlug);
		readableCategorySlugs = readableSlugs !== null ? new Set(readableSlugs) : null;
	}

	// 1. Discussion replies (excluding soft-deleted replies and discussions)
	const replyRows = await db
		.select({
			id: replies.id,
			contentJson: replies.contentJson,
			createdAt: replies.createdAt,
			discussionId: replies.discussionId,
			discussionTitle: discussions.title,
			discussionSlug: discussions.slug,
			categorySlug: discussions.categorySlug
		})
		.from(replies)
		.innerJoin(discussions, eq(replies.discussionId, discussions.id))
		.where(
			and(eq(replies.authorId, userId), isNull(replies.deletedAt), isNull(discussions.deletedAt))
		)
		.limit(COMMENT_LIST_LIMIT);

	// Filter replies by readable categories
	const filteredReplyRows = readableCategorySlugs
		? replyRows.filter((r) => readableCategorySlugs!.has(r.categorySlug))
		: replyRows;

	const replyItems: UserCommentItem[] = filteredReplyRows.map((r) => ({
		id: r.id,
		kind: 'reply',
		contentJson: r.contentJson,
		createdAt: r.createdAt,
		discussionId: r.discussionId,
		discussionTitle: r.discussionTitle,
		discussionSlug: r.discussionSlug,
		parentActivityId: null
	}));

	// 2. Activity comments - exclude comments whose parent activity is soft-deleted
	const commentRows = await db
		.select({
			id: activities.id,
			contentJson: activities.contentJson,
			createdAt: activities.createdAt,
			parentActivityId: activities.parentActivityId
		})
		.from(activities)
		.where(
			and(
				eq(activities.authorId, userId),
				isNull(activities.deletedAt),
				isNotNull(activities.parentActivityId),
				sql`NOT EXISTS (SELECT 1 FROM activities p WHERE p.id = activities.parent_activity_id AND p.deleted_at IS NOT NULL)`
			)
		)
		.limit(COMMENT_LIST_LIMIT);

	const commentItems: UserCommentItem[] = commentRows.map((c) => ({
		id: c.id,
		kind: 'activity_comment',
		contentJson: c.contentJson,
		createdAt: c.createdAt,
		discussionId: null,
		discussionTitle: null,
		discussionSlug: null,
		parentActivityId: c.parentActivityId
	}));

	// 3. Merge + sort newest first
	return [...replyItems, ...commentItems].sort(
		(a, b) => b.createdAt.getTime() - a.createdAt.getTime()
	);
}

/**
 * Get the list of category slugs the given group can read.
 * Returns null if all categories are readable (admin/moderator default).
 */
async function getReadableCategorySlugs(db: D1Db, groupSlug: string): Promise<string[] | null> {
	if (groupSlug === 'admin' || groupSlug === 'moderator') {
		return null;
	}

	const allCats = await db.select({ slug: categories.slug }).from(categories);
	const allSlugs = allCats.map((c) => c.slug);

	if (allSlugs.length === 0) return [];

	const permRows = await db
		.select({
			categorySlug: categoryPermissions.categorySlug,
			canRead: categoryPermissions.canRead
		})
		.from(categoryPermissions)
		.where(eq(categoryPermissions.groupSlug, groupSlug));

	const permMap = new Map(permRows.map((p) => [p.categorySlug, p.canRead]));

	return allSlugs.filter((slug) => {
		const canRead = permMap.get(slug);
		return canRead === undefined ? true : canRead;
	});
}
