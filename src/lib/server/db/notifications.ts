/**
 * Notification Dispatcher (RQ00-Backend §5.4).
 *
 * Centralizes all notification side-effects triggered by content creation.
 * Each entry-point resolves the relevant recipient set, batch-fetches their
 * notification preferences, and inserts one notification per eligible user.
 *
 * Per-category preference mapping:
 *  - mention            -> pref.mention
 *  - discussion owner   -> pref.discussionReply || pref.discussionComment
 *  - thread participant -> pref.participatedComment
 *  - bookmark subscriber-> pref.bookmarkedDiscussionComment
 *  - private message    -> pref.privateMessage
 *
 * A user receives at most one notification per content-creation event: when a
 * user qualifies under several categories, the most specific category wins
 * (mention > owner > participant > bookmarker).
 *
 * Private message mentions bypass `@mention` notification dispatch entirely,
 * so private content is never leaked to users outside the conversation.
 */
import {
	users,
	notifications,
	notificationPreferences,
	discussions,
	replies,
	bookmarks,
	conversationParticipants,
	conversations
} from './schema';
import { eq, and, isNull, ne, inArray } from 'drizzle-orm';
import type { D1Db } from './index';
import { extractMentions } from '$lib/utils/mentions';

type ReplyNotifCategory = 'mention' | 'owner' | 'participant' | 'bookmarker';

interface ReplyNotificationContext {
	discussionId: string;
	replyId: string;
	authorId: string;
	contentJson: string;
}

interface NewNotificationRow {
	id: string;
	userId: string;
	type: string;
	sourceUserId: string;
	discussionId: string;
	replyId: string;
	createdAt: Date;
}

/**
 * Dispatch notifications triggered by a new discussion reply.
 */
export async function dispatchReplyNotifications(
	db: D1Db,
	ctx: ReplyNotificationContext
): Promise<void> {
	// 1. Resolve the discussion owner (skip if the discussion is soft-deleted)
	const discussionRecords = await db
		.select({ authorId: discussions.authorId })
		.from(discussions)
		.where(and(eq(discussions.id, ctx.discussionId), isNull(discussions.deletedAt)))
		.limit(1);

	if (discussionRecords.length === 0) {
		return;
	}

	const ownerId = discussionRecords[0].authorId;

	// 2. Resolve mentioned user IDs from the reply content
	const mentionUsernames = extractMentions(ctx.contentJson);
	const mentionIds: string[] = [];
	if (mentionUsernames.length > 0) {
		const mentionedUsers = await db
			.select({ id: users.id })
			.from(users)
			.where(inArray(users.username, mentionUsernames));
		for (const m of mentionedUsers) {
			if (m.id !== ctx.authorId) {
				mentionIds.push(m.id);
			}
		}
	}

	// 3. Resolve other thread participants (distinct prior reply authors)
	const participantRows = await db
		.select({ authorId: replies.authorId })
		.from(replies)
		.where(
			and(
				eq(replies.discussionId, ctx.discussionId),
				isNull(replies.deletedAt),
				ne(replies.authorId, ctx.authorId)
			)
		);
	const participantIds = [...new Set(participantRows.map((r) => r.authorId))];

	// 4. Resolve bookmark subscribers
	const bookmarkerRows = await db
		.select({ userId: bookmarks.userId })
		.from(bookmarks)
		.where(eq(bookmarks.discussionId, ctx.discussionId));
	const bookmarkerIds = [
		...new Set(bookmarkerRows.map((b) => b.userId).filter((id) => id !== ctx.authorId))
	];

	// 5. Build candidate map with category priority (first-write wins)
	const candidates = new Map<string, ReplyNotifCategory>();
	for (const id of mentionIds) {
		if (!candidates.has(id)) candidates.set(id, 'mention');
	}
	if (ownerId !== ctx.authorId && !candidates.has(ownerId)) {
		candidates.set(ownerId, 'owner');
	}
	for (const id of participantIds) {
		if (!candidates.has(id)) candidates.set(id, 'participant');
	}
	for (const id of bookmarkerIds) {
		if (!candidates.has(id)) candidates.set(id, 'bookmarker');
	}

	if (candidates.size === 0) {
		return;
	}

	// 6. Batch-fetch preferences for all candidates
	const candidateIds = [...candidates.keys()];
	const prefs = await db
		.select()
		.from(notificationPreferences)
		.where(inArray(notificationPreferences.userId, candidateIds));
	const prefMap = new Map(prefs.map((p) => [p.userId, p]));

	// 7. Insert one notification per eligible candidate
	const now = new Date();
	const rows: NewNotificationRow[] = [];
	for (const [userId, category] of candidates) {
		const pref = prefMap.get(userId);
		const eligible = isEligible(category, pref);
		if (!eligible) continue;

		rows.push({
			id: crypto.randomUUID(),
			userId,
			type: notificationTypeFor(category),
			sourceUserId: ctx.authorId,
			discussionId: ctx.discussionId,
			replyId: ctx.replyId,
			createdAt: now
		});
	}

	if (rows.length > 0) {
		await db.insert(notifications).values(rows);
	}
}

interface MessageNotificationContext {
	conversationId: string;
	messageId: string;
	authorId: string;
}

/**
 * Dispatch notifications to the other participants of a conversation on a new
 * private message. Per §5.4, `@mention` notifications are intentionally
 * bypassed for private messages so content is never leaked outside the thread.
 */
export async function dispatchMessageNotifications(
	db: D1Db,
	ctx: MessageNotificationContext
): Promise<void> {
	// Ensure the conversation is still active (not soft-deleted)
	const conversationRecords = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(and(eq(conversations.id, ctx.conversationId), isNull(conversations.deletedAt)))
		.limit(1);

	if (conversationRecords.length === 0) {
		return;
	}

	const participantRows = await db
		.select({ userId: conversationParticipants.userId })
		.from(conversationParticipants)
		.where(
			and(
				eq(conversationParticipants.conversationId, ctx.conversationId),
				ne(conversationParticipants.userId, ctx.authorId)
			)
		);

	if (participantRows.length === 0) {
		return;
	}

	const recipientIds = [...new Set(participantRows.map((p) => p.userId))];

	const prefs = await db
		.select()
		.from(notificationPreferences)
		.where(inArray(notificationPreferences.userId, recipientIds));
	const prefMap = new Map(prefs.map((p) => [p.userId, p]));

	const now = new Date();
	const rows: {
		id: string;
		userId: string;
		type: string;
		sourceUserId: string;
		messageId: string;
		createdAt: Date;
	}[] = [];
	for (const userId of recipientIds) {
		const pref = prefMap.get(userId);
		const eligible = pref ? pref.privateMessage : true;
		if (!eligible) continue;

		rows.push({
			id: crypto.randomUUID(),
			userId,
			type: 'message',
			sourceUserId: ctx.authorId,
			messageId: ctx.messageId,
			createdAt: now
		});
	}

	if (rows.length > 0) {
		await db.insert(notifications).values(rows);
	}
}

interface NotificationPreferenceFields {
	mention: boolean;
	discussionReply: boolean;
	discussionComment: boolean;
	participatedComment: boolean;
	bookmarkedDiscussionComment: boolean;
}

function isEligible(
	category: ReplyNotifCategory,
	pref: NotificationPreferenceFields | undefined
): boolean {
	// No preference row means default-true for every category.
	if (!pref) return true;
	switch (category) {
		case 'mention':
			return pref.mention;
		case 'owner':
			return pref.discussionReply || pref.discussionComment;
		case 'participant':
			return pref.participatedComment;
		case 'bookmarker':
			return pref.bookmarkedDiscussionComment;
	}
}

function notificationTypeFor(category: ReplyNotifCategory): string {
	if (category === 'mention') return 'mention';
	if (category === 'owner') return 'reply';
	return 'discussion_comment';
}
