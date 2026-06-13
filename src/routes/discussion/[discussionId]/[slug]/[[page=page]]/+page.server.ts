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

export const load: PageServerLoad = async (event) => {
	const { discussionId, slug } = event.params;
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
	if (discussion.slug !== slug) {
		redirect(302, `/discussion/${discussionId}/${discussion.slug}`);
	}

	// 2. Check read permissions for this category (guest-safe via resolvePermissions)
	const perms = await resolvePermissions(db, discussion.categorySlug, user);
	if (!perms.canRead) {
		error(403, event.locals.t.common.forbidden);
	}

	// 2b. Resolve canDelete for sticky/unsticky toggle
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
		const totalRes = await db
			.select({ count: count() })
			.from(replies)
			.where(
				and(
					eq(replies.discussionId, discussionId),
					isNull(replies.deletedAt),
					ne(replies.id, opReply.id)
				)
			);
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
		mentionedUsers
	};
};

export const actions: Actions = {
	reply: async ({ request, locals, params }) => {
		const user = locals.user;
		if (!user) {
			error(401, locals.t.common.unauthorized);
		}

		const db = locals.db;
		const { discussionId } = params;
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

		if (!contentJson) {
			return { success: false, error: locals.t.discussion.replyEmpty };
		}

		// Insert the reply
		const replyId = crypto.randomUUID();
		await db.insert(replies).values({
			id: replyId,
			discussionId,
			authorId: user.id,
			contentJson,
			createdAt: new Date(),
			updatedAt: new Date()
		});

		// Update discussion commentCount and updatedAt timestamp
		await db
			.update(discussions)
			.set({
				commentCount: sql`${discussions.commentCount} + 1`,
				updatedAt: new Date()
			})
			.where(eq(discussions.id, discussionId));

		// Clear the draft from DB
		await db
			.delete(drafts)
			.where(
				and(
					eq(drafts.authorId, user.id),
					eq(drafts.contextType, 'reply'),
					eq(drafts.contextId, discussionId)
				)
			);

		// Dispatch notifications (mentions, owner, participants, bookmarkers)
		await dispatchReplyNotifications(db, {
			discussionId,
			replyId,
			authorId: user.id,
			contentJson
		});

		return { success: true, replyId };
	},

	togglePin: async ({ locals, params }) => {
		const user = locals.user;
		if (!user) {
			error(401, locals.t.common.unauthorized);
		}

		const db = locals.db;
		const { discussionId } = params;
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
	}
};
