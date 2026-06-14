import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	discussions,
	categories,
	replies,
	users,
	discussionReads,
	notifications,
	drafts
} from '$lib/server/db/schema';
import { eq, and, isNull, count, ne, sql } from 'drizzle-orm';
import { getPaginationLimit, resolvePermissions } from '$lib/server/constants';
import { dispatchReplyNotifications } from '$lib/server/db/notifications';
import { resolveMentions } from '$lib/server/utils/mentions';
import type { DbTransaction } from '$lib/server/db';
import { isLexicalEmpty, MAX_CONTENT_SIZE } from '$lib/utils/lexical';
import { indexReply, reindexReply, unindexReply, unindexDiscussion } from '$lib/server/search/fts';

export const load: PageServerLoad = async (event) => {
	const slug = event.params.slug;
	const discussionId = Number(event.params.discussionId);
	if (!discussionId) {
		error(404, event.locals.t.discussion.notFound);
	}
	const db = event.locals.db;
	const user = event.locals.user;

	// 1. Fetch discussion, category, and author details
	const discussionRecords = await db
		.select({
			id: discussions.id,
			title: discussions.title,
			slug: discussions.slug,
			categorySlug: discussions.categorySlug,
			authorId: discussions.authorId,
			viewCount: discussions.viewCount,
			commentCount: discussions.commentCount,
			isPinned: discussions.isPinned,
			themeName: discussions.themeName,
			createdAt: discussions.createdAt,
			updatedAt: discussions.updatedAt,
			categoryTitle: categories.title,
			categoryDescription: categories.description,
			categoryTheme: categories.themeName,
			authorDisplayName: users.displayName,
			authorUsername: users.username,
			authorAvatarFileId: users.avatarFileId
		})
		.from(discussions)
		.innerJoin(categories, eq(discussions.categorySlug, categories.slug))
		.innerJoin(users, eq(discussions.authorId, users.id))
		.where(and(eq(discussions.id, discussionId), isNull(discussions.deletedAt)))
		.limit(1);

	if (discussionRecords.length === 0) {
		error(404, event.locals.t.discussion.notFound);
	}
	const discussion = discussionRecords[0];

	// Canonical slug redirect if slug in URL is mismatch
	let decodedDbSlug = discussion.slug;
	try {
		decodedDbSlug = decodeURIComponent(discussion.slug);
	} catch {
		// Ignore decode error and keep original slug
	}

	if (decodedDbSlug !== slug) {
		const pageParam = event.params.page;
		redirect(
			302,
			`/discussion/${discussionId}/${discussion.slug}${pageParam ? '/' + pageParam : ''}`
		);
	}

	// 2. Check read permissions for this category (guest-safe via resolvePermissions)
	const perms = await resolvePermissions(db, discussion.categorySlug, user);
	if (!perms.canRead) {
		error(403, event.locals.t.common.forbidden);
	}

	// 2b. Resolve canDelete for pin/unpin toggle
	const canDelete = user ? perms.canDelete : false;

	// 3. Resolve page number
	const pageParam = event.params.page;
	let page = 1;
	if (pageParam) {
		const parsed = parseInt(pageParam.substring(1), 10);
		if (!isNaN(parsed) && parsed >= 1) {
			page = parsed;
		}
	}

	const limit = getPaginationLimit(event.platform?.env);

	// 4. Fetch the Original Post (OP) (earliest reply chronologically)
	const opRecord = await db
		.select({
			id: replies.id,
			contentJson: replies.contentJson,
			createdAt: replies.createdAt,
			updatedAt: replies.updatedAt,
			authorId: replies.authorId,
			authorDisplayName: users.displayName,
			authorUsername: users.username,
			authorAvatarFileId: users.avatarFileId
		})
		.from(replies)
		.innerJoin(users, eq(replies.authorId, users.id))
		.where(and(eq(replies.discussionId, discussionId), isNull(replies.deletedAt)))
		.orderBy(replies.createdAt)
		.limit(1);

	const opReply = opRecord.length > 0 ? opRecord[0] : null;

	// 5. Fetch total count of replies excluding the OP
	let totalRepliesCount = 0;
	if (opReply) {
		const replyFilters = [eq(replies.discussionId, discussionId), isNull(replies.deletedAt)];
		if (opReply.id) {
			replyFilters.push(ne(replies.id, opReply.id));
		}

		const totalRes = await db
			.select({ count: count() })
			.from(replies)
			.where(and(...replyFilters));
		totalRepliesCount = totalRes[0]?.count || 0;
	}

	const totalPages = Math.max(1, Math.ceil(totalRepliesCount / limit));

	// 6. Fetch paginated replies stream excluding the OP
	let repliesStream: typeof opRecord = [];
	if (opReply) {
		repliesStream = await db
			.select({
				id: replies.id,
				contentJson: replies.contentJson,
				createdAt: replies.createdAt,
				updatedAt: replies.updatedAt,
				authorId: replies.authorId,
				authorDisplayName: users.displayName,
				authorUsername: users.username,
				authorAvatarFileId: users.avatarFileId
			})
			.from(replies)
			.innerJoin(users, eq(replies.authorId, users.id))
			.where(
				and(
					eq(replies.discussionId, discussionId),
					isNull(replies.deletedAt),
					ne(replies.id, opReply.id)
				)
			)
			.orderBy(replies.createdAt)
			.limit(limit)
			.offset((page - 1) * limit);
	}

	// 7. Update view count
	await db
		.update(discussions)
		.set({ viewCount: sql`${discussions.viewCount} + 1` })
		.where(eq(discussions.id, discussionId));

	// 8. Update reading history for logged-in user
	if (user) {
		const lastReplyId =
			repliesStream.length > 0
				? repliesStream[repliesStream.length - 1].id
				: opReply
					? opReply.id
					: null;

		await db
			.insert(discussionReads)
			.values({
				userId: user.id,
				discussionId,
				lastReadAt: new Date(),
				lastReadPage: page,
				lastReadReplyId: lastReplyId
			})
			.onConflictDoUpdate({
				target: [discussionReads.userId, discussionReads.discussionId],
				set: {
					lastReadAt: new Date(),
					lastReadPage: page,
					lastReadReplyId: lastReplyId
				}
			});

		// 9. Resolve notifications for this discussion
		await db
			.update(notifications)
			.set({ isRead: true })
			.where(
				and(
					eq(notifications.userId, user.id),
					eq(notifications.discussionId, discussionId),
					eq(notifications.isRead, false)
				)
			);
	}

	// 10. Resolve theme: Discussion Theme -> Category Theme -> default
	const resolvedTheme = discussion.themeName || discussion.categoryTheme || null;

	// Fetch existing draft for bottom reply editor if logged in
	let replyDraft = null;
	if (user) {
		const draftRecords = await db
			.select({ contentJson: drafts.contentJson })
			.from(drafts)
			.where(
				and(
					eq(drafts.authorId, user.id),
					eq(drafts.contextType, 'reply'),
					eq(drafts.contextId, discussionId)
				)
			)
			.limit(1);
		if (draftRecords.length > 0) {
			replyDraft = draftRecords[0].contentJson;
		}
	}

	// 11. Resolve @mentions across OP + reply content for chip rendering
	const allContentJsons = [opReply?.contentJson, ...repliesStream.map((r) => r.contentJson)];
	const mentionedUsers = await resolveMentions(allContentJsons, db);

	return {
		discussion,
		opReply,
		replies: repliesStream,
		page,
		totalPages,
		totalRepliesCount,
		theme: resolvedTheme,
		replyDraft,
		canDelete,
		canUpdate: perms.canUpdate,
		canCreate: perms.canCreate,
		user,
		mentionedUsers
	};
};

export const actions: Actions = {
	reply: async ({ request, locals, params, platform }) => {
		const user = locals.user;
		if (!user) {
			error(401, locals.t.common.unauthorized);
		}

		const db = locals.db;
		const discussionId = Number(params.discussionId);
		if (!discussionId) {
			error(400, locals.t.common.badRequest);
		}

		// Verify discussion exists and is not soft-deleted
		const discussionRecords = await db
			.select({
				categorySlug: discussions.categorySlug
			})
			.from(discussions)
			.where(and(eq(discussions.id, discussionId), isNull(discussions.deletedAt)))
			.limit(1);

		if (discussionRecords.length === 0) {
			error(404, locals.t.discussion.notFound);
		}

		// Verify user's group has write permission for this category
		const perms = await resolvePermissions(db, discussionRecords[0].categorySlug, user);
		if (!perms.canCreate) {
			error(403, locals.t.common.forbidden);
		}

		const data = await request.formData();
		const contentJson = data.get('contentJson') as string;

		if (isLexicalEmpty(contentJson)) {
			return { success: false, error: locals.t.discussion.replyEmpty };
		}
		if (contentJson.length > MAX_CONTENT_SIZE) {
			return { success: false, error: locals.t.common.contentTooLarge };
		}

		// Insert the reply, update discussion stats, and clear draft in a transaction.
		// replies.id is auto-assigned; read it back via returning().
		let replyId: number;
		try {
			replyId = await db.transaction(async (tx: DbTransaction) => {
				const inserted = await tx
					.insert(replies)
					.values({
						discussionId,
						authorId: user.id,
						contentJson,
						createdAt: new Date(),
						updatedAt: new Date()
					})
					.returning({ id: replies.id });
				await indexReply(tx, inserted[0].id, contentJson);

				await tx
					.update(discussions)
					.set({
						commentCount: sql`${discussions.commentCount} + 1`,
						updatedAt: new Date()
					})
					.where(eq(discussions.id, discussionId));

				await tx
					.delete(drafts)
					.where(
						and(
							eq(drafts.authorId, user.id),
							eq(drafts.contextType, 'reply'),
							eq(drafts.contextId, discussionId)
						)
					);

				return inserted[0].id;
			});
		} catch (err) {
			console.error('Failed to create reply:', err);
			error(500, locals.t.common.internalError);
		}

		// Dispatch notifications (mentions, owner, participants, bookmarkers)
		await dispatchReplyNotifications(db, {
			discussionId,
			replyId,
			authorId: user.id,
			contentJson
		});

		// Calculate which page the new reply lands on (excluding OP)
		const opRecord = await db
			.select({ id: replies.id })
			.from(replies)
			.where(and(eq(replies.discussionId, discussionId), isNull(replies.deletedAt)))
			.orderBy(replies.createdAt)
			.limit(1);
		const opId = opRecord.length > 0 ? opRecord[0].id : null;

		const countConditions = [eq(replies.discussionId, discussionId), isNull(replies.deletedAt)];
		if (opId) {
			countConditions.push(ne(replies.id, opId));
		}

		const newCountRes = await db
			.select({ value: count() })
			.from(replies)
			.where(and(...countConditions));
		const newCount = newCountRes[0]?.value ?? 1;
		const limit = getPaginationLimit(platform?.env);
		const replyPage = Math.max(1, Math.ceil(newCount / limit));

		return { success: true, replyId, page: replyPage };
	},

	togglePin: async ({ locals, params }) => {
		const user = locals.user;
		if (!user) {
			error(401, locals.t.common.unauthorized);
		}

		const db = locals.db;
		const discussionId = Number(params.discussionId);
		if (!discussionId) {
			error(400, locals.t.common.badRequest);
		}

		// Fetch discussion to get categorySlug
		const discussionRecords = await db
			.select({
				categorySlug: discussions.categorySlug,
				isPinned: discussions.isPinned
			})
			.from(discussions)
			.where(and(eq(discussions.id, discussionId), isNull(discussions.deletedAt)))
			.limit(1);

		if (discussionRecords.length === 0) {
			error(404, locals.t.discussion.notFound);
		}

		const { categorySlug, isPinned } = discussionRecords[0];

		// Verify canDelete permission via centralized helper
		const perms = await resolvePermissions(db, categorySlug, user);
		if (!perms.canDelete) {
			error(403, locals.t.common.forbidden);
		}

		// Toggle isPinned
		await db
			.update(discussions)
			.set({ isPinned: !isPinned, updatedAt: new Date() })
			.where(eq(discussions.id, discussionId));

		return { success: true, isPinned: !isPinned };
	},

	editReply: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) {
			error(401, locals.t.common.unauthorized);
		}

		const db = locals.db;
		const data = await request.formData();
		const replyId = Number(data.get('replyId'));
		const contentJson = data.get('contentJson') as string;

		if (!replyId || isLexicalEmpty(contentJson)) {
			error(400, locals.t.common.badRequest);
		}
		if (contentJson.length > MAX_CONTENT_SIZE) {
			error(400, locals.t.common.contentTooLarge);
		}

		// Fetch reply and associated discussion categorySlug to check permissions
		const replyRecords = await db
			.select({
				id: replies.id,
				authorId: replies.authorId,
				discussionId: replies.discussionId,
				categorySlug: discussions.categorySlug,
				contentJson: replies.contentJson
			})
			.from(replies)
			.innerJoin(discussions, eq(replies.discussionId, discussions.id))
			.where(and(eq(replies.id, replyId), isNull(replies.deletedAt), isNull(discussions.deletedAt)))
			.limit(1);

		if (replyRecords.length === 0) {
			error(404, locals.t.common.notFound);
		}
		const replyRecord = replyRecords[0];

		// Check permissions: canUpdate permission or author
		const perms = await resolvePermissions(db, replyRecord.categorySlug, user);
		const isAuthor = user.id === replyRecord.authorId;
		if (!perms.canUpdate && !isAuthor) {
			error(403, locals.t.common.forbidden);
		}

		// Verify the reply is not the OP (earliest reply)
		const opRecord = await db
			.select({ id: replies.id })
			.from(replies)
			.where(and(eq(replies.discussionId, replyRecord.discussionId), isNull(replies.deletedAt)))
			.orderBy(replies.createdAt)
			.limit(1);

		if (opRecord.length > 0 && opRecord[0].id === replyId) {
			error(400, locals.t.common.badRequest);
		}

		// Update reply and reindex its search text atomically.
		await db.transaction(async (tx: DbTransaction) => {
			await tx
				.update(replies)
				.set({ contentJson, updatedAt: new Date() })
				.where(eq(replies.id, replyId));
			await reindexReply(tx, replyId, replyRecord.contentJson, contentJson);
		});

		return { success: true };
	},

	deleteReply: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) {
			error(401, locals.t.common.unauthorized);
		}

		const db = locals.db;
		const data = await request.formData();
		const replyId = Number(data.get('replyId'));

		if (!replyId) {
			error(400, locals.t.common.badRequest);
		}

		// Fetch reply and associated discussion categorySlug to check permissions
		const replyRecords = await db
			.select({
				id: replies.id,
				discussionId: replies.discussionId,
				categorySlug: discussions.categorySlug,
				contentJson: replies.contentJson
			})
			.from(replies)
			.innerJoin(discussions, eq(replies.discussionId, discussions.id))
			.where(and(eq(replies.id, replyId), isNull(replies.deletedAt), isNull(discussions.deletedAt)))
			.limit(1);

		if (replyRecords.length === 0) {
			error(404, locals.t.common.notFound);
		}
		const replyRecord = replyRecords[0];

		// Check permissions: canDelete
		const perms = await resolvePermissions(db, replyRecord.categorySlug, user);
		if (!perms.canDelete) {
			error(403, locals.t.common.forbidden);
		}

		// Verify the reply is not the OP (earliest reply)
		const opRecord = await db
			.select({ id: replies.id })
			.from(replies)
			.where(and(eq(replies.discussionId, replyRecord.discussionId), isNull(replies.deletedAt)))
			.orderBy(replies.createdAt)
			.limit(1);

		if (opRecord.length > 0 && opRecord[0].id === replyId) {
			error(400, locals.t.common.badRequest);
		}

		try {
			await db.transaction(async (tx: DbTransaction) => {
				await tx.update(replies).set({ deletedAt: new Date() }).where(eq(replies.id, replyId));
				await unindexReply(tx, replyId, replyRecord.contentJson);

				await tx
					.update(discussions)
					.set({
						commentCount: sql`${discussions.commentCount} - 1`,
						updatedAt: new Date()
					})
					.where(eq(discussions.id, replyRecord.discussionId));
			});
		} catch (err) {
			console.error('Failed to delete reply:', err);
			error(500, locals.t.common.internalError);
		}

		return { success: true };
	},

	deleteDiscussion: async ({ locals, params }) => {
		const user = locals.user;
		if (!user) {
			error(401, locals.t.common.unauthorized);
		}

		const db = locals.db;
		const discussionId = Number(params.discussionId);
		if (!discussionId) {
			error(400, locals.t.common.badRequest);
		}

		// Fetch discussion categorySlug
		const discussionRecords = await db
			.select({
				categorySlug: discussions.categorySlug,
				title: discussions.title
			})
			.from(discussions)
			.where(and(eq(discussions.id, discussionId), isNull(discussions.deletedAt)))
			.limit(1);

		if (discussionRecords.length === 0) {
			error(404, locals.t.discussion.notFound);
		}
		const { categorySlug, title } = discussionRecords[0];

		// Check permissions: canDelete
		const perms = await resolvePermissions(db, categorySlug, user);
		if (!perms.canDelete) {
			error(403, locals.t.common.forbidden);
		}

		// Soft delete discussion
		await db
			.update(discussions)
			.set({
				deletedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(discussions.id, discussionId));

		// Remove the title from the search index. Replies are left indexed; search
		// queries JOIN discussions and filter deletedAt, so they are excluded anyway.
		await unindexDiscussion(db, discussionId, title);

		redirect(303, '/');
	}
};
