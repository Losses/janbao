import { error } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	conversations,
	conversationParticipants,
	conversationReads,
	messages,
	users,
	notifications,
	drafts
} from '$lib/server/db/schema';
import { eq, and, isNull, count, sql } from 'drizzle-orm';
import { getPaginationLimit } from '$lib/server/constants';
import { dispatchMessageNotifications } from '$lib/server/db/notifications';

const MESSAGE_PAGE_FALLBACK = 50;

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) {
		error(401, event.locals.t.common.unauthorized);
	}

	const { id: conversationId } = event.params;
	const db = event.locals.db;
	const t = event.locals.t;

	// 1. Fetch conversation (must exist and not be soft-deleted)
	const conversationRecords = await db
		.select({
			id: conversations.id,
			title: conversations.title,
			createdAt: conversations.createdAt
		})
		.from(conversations)
		.where(and(eq(conversations.id, conversationId), isNull(conversations.deletedAt)))
		.limit(1);

	if (conversationRecords.length === 0) {
		error(404, t.message.conversationNotFound);
	}

	const conversation = conversationRecords[0];

	// 2. Verify the user is a participant
	const participantCheck = await db
		.select({ userId: conversationParticipants.userId })
		.from(conversationParticipants)
		.where(
			and(
				eq(conversationParticipants.conversationId, conversationId),
				eq(conversationParticipants.userId, user.id)
			)
		)
		.limit(1);

	if (participantCheck.length === 0) {
		error(403, t.common.forbidden);
	}

	// 3. Resolve page number from optional [[page=page]] matcher
	const pageParam = event.params.page;
	let page = 1;
	if (pageParam) {
		const parsed = parseInt(pageParam.substring(1), 10);
		if (!isNaN(parsed) && parsed >= 1) {
			page = parsed;
		}
	}

	const limit = getPaginationLimit(event.platform?.env) || MESSAGE_PAGE_FALLBACK;

	// 4. Fetch all participants (sidebar) with display info
	const participants = await db
		.select({
			userId: conversationParticipants.userId,
			username: users.username,
			displayName: users.displayName,
			avatarFileId: users.avatarFileId
		})
		.from(conversationParticipants)
		.innerJoin(users, eq(conversationParticipants.userId, users.id))
		.where(eq(conversationParticipants.conversationId, conversationId));

	// 5. Total message count + paginated message stream (oldest first)
	const totalResult = await db
		.select({ value: count() })
		.from(messages)
		.where(eq(messages.conversationId, conversationId));
	const totalCount = totalResult[0]?.value ?? 0;
	const totalPages = Math.max(1, Math.ceil(totalCount / limit));

	const messageRows = await db
		.select({
			id: messages.id,
			conversationId: messages.conversationId,
			authorId: messages.authorId,
			contentJson: messages.contentJson,
			createdAt: messages.createdAt,
			updatedAt: messages.updatedAt,
			authorDisplayName: users.displayName,
			authorUsername: users.username,
			authorAvatarFileId: users.avatarFileId
		})
		.from(messages)
		.innerJoin(users, eq(messages.authorId, users.id))
		.where(eq(messages.conversationId, conversationId))
		.orderBy(messages.createdAt)
		.limit(limit)
		.offset((page - 1) * limit);

	// 6. Mark conversation as read for the active user
	await db
		.insert(conversationReads)
		.values({
			userId: user.id,
			conversationId,
			lastReadAt: new Date()
		})
		.onConflictDoUpdate({
			target: [conversationReads.userId, conversationReads.conversationId],
			set: { lastReadAt: new Date() }
		});

	// 7. Resolve pending message notifications for this conversation (single
	// UPDATE with a subquery — no id round-trip, no bind-variable ceiling).
	await db
		.update(notifications)
		.set({ isRead: true })
		.where(
			and(
				eq(notifications.userId, user.id),
				eq(notifications.isRead, false),
				sql`${notifications.messageId} IN (SELECT id FROM messages WHERE conversation_id = ${conversationId})`
			)
		);

	// 8. Load composer draft
	let messageDraft: string | null = null;
	const draftRows = await db
		.select({ contentJson: drafts.contentJson })
		.from(drafts)
		.where(
			and(
				eq(drafts.authorId, user.id),
				eq(drafts.contextType, 'message'),
				eq(drafts.contextId, conversationId)
			)
		)
		.limit(1);
	if (draftRows.length > 0) {
		messageDraft = draftRows[0].contentJson;
	}

	return {
		conversation,
		participants,
		messages: messageRows,
		page,
		totalPages,
		totalCount,
		messageDraft
	};
};

export const actions: Actions = {
	// Add a participant to the conversation. Only an existing participant may
	// invite; the target must exist and not already be a participant.
	addParticipant: async ({ request, locals, params }) => {
		const user = locals.user;
		if (!user) {
			error(401, locals.t.common.unauthorized);
		}

		const { id: conversationId } = params;
		const db = locals.db;
		const t = locals.t;

		const participantCheck = await db
			.select({ userId: conversationParticipants.userId })
			.from(conversationParticipants)
			.innerJoin(conversations, eq(conversationParticipants.conversationId, conversations.id))
			.where(
				and(
					eq(conversationParticipants.conversationId, conversationId),
					eq(conversationParticipants.userId, user.id),
					isNull(conversations.deletedAt)
				)
			)
			.limit(1);

		if (participantCheck.length === 0) {
			return { success: false, error: t.common.forbidden };
		}

		const data = await request.formData();
		const targetUserId = (data.get('userId') as string | null)?.trim();

		if (!targetUserId) {
			return { success: false, error: t.message.userIdRequired };
		}

		const targetExists = await db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.id, targetUserId))
			.limit(1);

		if (targetExists.length === 0) {
			return { success: false, error: t.message.recipientNotFound };
		}

		await db
			.insert(conversationParticipants)
			.values({
				conversationId,
				userId: targetUserId,
				joinedAt: new Date()
			})
			.onConflictDoNothing();

		return { success: true };
	},

	// Post a new message in the conversation.
	post: async ({ request, locals, params }) => {
		const user = locals.user;
		if (!user) {
			error(401, locals.t.common.unauthorized);
		}

		const { id: conversationId } = params;
		const db = locals.db;
		const t = locals.t;

		// Participant gate + conversation still active
		const participantCheck = await db
			.select({ conversationId: conversationParticipants.conversationId })
			.from(conversationParticipants)
			.innerJoin(conversations, eq(conversationParticipants.conversationId, conversations.id))
			.where(
				and(
					eq(conversationParticipants.conversationId, conversationId),
					eq(conversationParticipants.userId, user.id),
					isNull(conversations.deletedAt)
				)
			)
			.limit(1);

		if (participantCheck.length === 0) {
			return { success: false, error: t.common.forbidden };
		}

		const data = await request.formData();
		const contentJson = (data.get('contentJson') as string | null) || '';

		if (!contentJson) {
			return { success: false, error: t.common.contentRequired };
		}
		if (contentJson.length > 512 * 1024) {
			return { success: false, error: t.common.contentTooLarge };
		}

		const messageId = crypto.randomUUID();
		const now = new Date();
		await db.insert(messages).values({
			id: messageId,
			conversationId,
			authorId: user.id,
			contentJson,
			createdAt: now,
			updatedAt: now
		});

		// Clear the composer draft
		await db
			.delete(drafts)
			.where(
				and(
					eq(drafts.authorId, user.id),
					eq(drafts.contextType, 'message'),
					eq(drafts.contextId, conversationId)
				)
			);

		// Keep the author's read pointer at "now" so their own reply does not
		// inflate their inbox unread badge.
		await db
			.insert(conversationReads)
			.values({
				userId: user.id,
				conversationId,
				lastReadAt: now
			})
			.onConflictDoUpdate({
				target: [conversationReads.userId, conversationReads.conversationId],
				set: { lastReadAt: now }
			});

		// Notify other participants (PM @mention notifications are bypassed)
		await dispatchMessageNotifications(db, {
			conversationId,
			messageId,
			authorId: user.id
		});

		return { success: true, messageId };
	},

	// Edit a message authored by the active user. PMs can be edited but never
	// deleted (no ConfirmationModal), per RQ00-Frontend §6.5.
	editMessage: async ({ request, locals, params }) => {
		const user = locals.user;
		if (!user) {
			error(401, locals.t.common.unauthorized);
		}

		const { id: conversationId } = params;
		const db = locals.db;
		const t = locals.t;

		const data = await request.formData();
		const messageId = (data.get('messageId') as string | null) || '';
		const contentJson = (data.get('contentJson') as string | null) || '';

		if (!messageId || !contentJson) {
			return { success: false, error: t.common.contentRequired };
		}
		if (contentJson.length > 512 * 1024) {
			return { success: false, error: t.common.contentTooLarge };
		}

		// Only the author may edit, and only within an active conversation
		const messageRecords = await db
			.select({ authorId: messages.authorId })
			.from(messages)
			.innerJoin(conversations, eq(messages.conversationId, conversations.id))
			.where(
				and(
					eq(messages.id, messageId),
					eq(messages.conversationId, conversationId),
					isNull(conversations.deletedAt)
				)
			)
			.limit(1);

		if (messageRecords.length === 0) {
			return { success: false, error: t.message.conversationNotFound };
		}
		if (messageRecords[0].authorId !== user.id) {
			return { success: false, error: t.common.forbidden };
		}

		await db
			.update(messages)
			.set({ contentJson, updatedAt: new Date() })
			.where(eq(messages.id, messageId));

		return { success: true };
	}
};
