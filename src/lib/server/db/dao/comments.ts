import { replies, discussions, activities } from '../schema';
import { eq, and, isNull, isNotNull } from 'drizzle-orm';
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

/**
 * UNION-style merge of a user's discussion replies and activity comments,
 * sorted chronologically (newest first). Per RQ00-Backend §6.3, both datasets
 * are fetched independently and merged in memory, each carrying its context
 * indicator (discussion title for replies, parent activity id for comments).
 */
export async function getUserComments(db: D1Db, userId: string): Promise<UserCommentItem[]> {
	// 1. Discussion replies (excluding soft-deleted replies and discussions)
	const replyRows = await db
		.select({
			id: replies.id,
			contentJson: replies.contentJson,
			createdAt: replies.createdAt,
			discussionId: replies.discussionId,
			discussionTitle: discussions.title,
			discussionSlug: discussions.slug
		})
		.from(replies)
		.innerJoin(discussions, eq(replies.discussionId, discussions.id))
		.where(
			and(eq(replies.authorId, userId), isNull(replies.deletedAt), isNull(discussions.deletedAt))
		);

	const replyItems: UserCommentItem[] = replyRows.map((r) => ({
		id: r.id,
		kind: 'reply',
		contentJson: r.contentJson,
		createdAt: r.createdAt,
		discussionId: r.discussionId,
		discussionTitle: r.discussionTitle,
		discussionSlug: r.discussionSlug,
		parentActivityId: null
	}));

	// 2. Activity comments (rows whose parentActivityId is set)
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
				isNotNull(activities.parentActivityId)
			)
		);

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
