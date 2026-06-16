import { replies, discussions, categories } from '../schema';
import { eq, and, isNull, desc, sql, count, inArray } from 'drizzle-orm';
import type { D1Db } from '../index';
import { getReadableCategorySlugs } from '$lib/server/constants';

export interface UserCommentItem {
	id: number;
	contentJson: string;
	createdAt: Date;
	discussionId: number;
	discussionTitle: string;
	discussionSlug: string;
}

export interface UserCommentsQuery {
	userId: number;
	groupSlug?: string;
}

export interface UserCommentsPageQuery extends UserCommentsQuery {
	limit: number;
	offset: number;
}

/**
 * Predicate that excludes a discussion's OP ("index-0" reply). The OP body is
 * stored as the first {@link replies} row of its discussion (see
 * `post/discussion/+page.server.ts`), so without this it would leak into the
 * comments feed. The OP is identified positionally - the earliest non-deleted
 * reply in a discussion - exactly mirroring the discussion detail page, which
 * picks the earliest reply as the OP and drops it by id.
 */
const isNotOpReply = sql`EXISTS (
	SELECT 1 FROM replies earlier
	WHERE earlier.discussion_id = replies.discussion_id
		AND earlier.deleted_at IS NULL
		AND (
			earlier.created_at < replies.created_at
			OR (earlier.created_at = replies.created_at AND earlier.id < replies.id)
		)
)`;

/**
 * Build the shared WHERE conditions for a user's comment (reply) feed:
 * authored by the user, not soft-deleted, parent discussion + category live,
 * not the OP, and restricted to categories the viewer can read when groupSlug
 * is provided.
 */
async function buildReplyConditions(db: D1Db, query: UserCommentsQuery) {
	const conditions = [
		eq(replies.authorId, query.userId),
		isNull(replies.deletedAt),
		isNull(discussions.deletedAt),
		isNull(categories.disabledAt),
		isNotOpReply
	];

	if (query.groupSlug) {
		const readableSlugs = await getReadableCategorySlugs(db, query.groupSlug);
		conditions.push(
			readableSlugs.length > 0 ? inArray(discussions.categorySlug, readableSlugs) : sql`1 = 0`
		);
	}

	return conditions;
}

/**
 * A user's discussion replies (newest first), excluding soft-deleted rows,
 * soft-deleted parents, the OP reply of each thread, and replies from
 * categories the viewer cannot read. Paginated via limit/offset - pair with
 * {@link getUserCommentsCount} to render a Paginator.
 */
export async function getUserComments(
	db: D1Db,
	query: UserCommentsPageQuery
): Promise<UserCommentItem[]> {
	const conditions = await buildReplyConditions(db, query);

	return db
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
		.innerJoin(categories, eq(discussions.categorySlug, categories.slug))
		.where(and(...conditions))
		.orderBy(desc(replies.createdAt), desc(replies.id))
		.limit(query.limit)
		.offset(query.offset);
}

/**
 * Total count matching {@link getUserComments} (same filters, no pagination),
 * for computing total pages.
 */
export async function getUserCommentsCount(db: D1Db, query: UserCommentsQuery): Promise<number> {
	const conditions = await buildReplyConditions(db, query);

	const res = await db
		.select({ count: count() })
		.from(replies)
		.innerJoin(discussions, eq(replies.discussionId, discussions.id))
		.innerJoin(categories, eq(discussions.categorySlug, categories.slug))
		.where(and(...conditions));

	return res[0]?.count || 0;
}
