import { notifications, users, discussions, messages } from '../schema';
import { eq, desc, inArray } from 'drizzle-orm';
import type { D1Db } from '../index';
import type { NotificationItem } from '$lib/types/api';

interface SourceUserInfo {
	displayName: string;
	username: string;
	avatarFileId: string | null;
}

interface DiscussionInfo {
	title: string;
	slug: string;
}

/**
 * Fetch the active user's notifications newest-first, batch-resolving source
 * user display info and referenced discussion titles. Shared by the
 * /api/notifications endpoint and the /notifications page loader.
 */
export async function getNotifications(
	db: D1Db,
	userId: string,
	limit: number
): Promise<NotificationItem[]> {
	const rows = await db
		.select({
			id: notifications.id,
			type: notifications.type,
			isRead: notifications.isRead,
			createdAt: notifications.createdAt,
			sourceUserId: notifications.sourceUserId,
			discussionId: notifications.discussionId,
			replyId: notifications.replyId,
			messageId: notifications.messageId,
			activityId: notifications.activityId
		})
		.from(notifications)
		.where(eq(notifications.userId, userId))
		.orderBy(desc(notifications.createdAt))
		.limit(limit);

	// Batch-resolve source user display info
	const sourceIds = rows.map((r) => r.sourceUserId).filter((id): id is string => id !== null);
	const sourceMap = new Map<string, SourceUserInfo>();
	if (sourceIds.length > 0) {
		const uniqueSourceIds = [...new Set(sourceIds)];
		const sourceUsers = await db
			.select({
				id: users.id,
				displayName: users.displayName,
				username: users.username,
				avatarFileId: users.avatarFileId
			})
			.from(users)
			.where(inArray(users.id, uniqueSourceIds));
		for (const u of sourceUsers) {
			sourceMap.set(u.id, {
				displayName: u.displayName,
				username: u.username,
				avatarFileId: u.avatarFileId
			});
		}
	}

	// Batch-resolve referenced discussion titles/slugs
	const discussionIds = rows.map((r) => r.discussionId).filter((id): id is string => id !== null);
	const discussionMap = new Map<string, DiscussionInfo>();
	if (discussionIds.length > 0) {
		const uniqueDiscussionIds = [...new Set(discussionIds)];
		const discussionRecords = await db
			.select({ id: discussions.id, title: discussions.title, slug: discussions.slug })
			.from(discussions)
			.where(inArray(discussions.id, uniqueDiscussionIds));
		for (const d of discussionRecords) {
			discussionMap.set(d.id, { title: d.title, slug: d.slug });
		}
	}

	// Batch-resolve conversation ids for private-message notifications (so the
	// notifications page can deep-link into the right conversation)
	const messageIds = rows
		.filter((r) => r.type === 'message' && r.messageId !== null)
		.map((r) => r.messageId as string);
	const messageConversationMap = new Map<string, string>();
	if (messageIds.length > 0) {
		const uniqueMessageIds = [...new Set(messageIds)];
		const messageRecords = await db
			.select({ id: messages.id, conversationId: messages.conversationId })
			.from(messages)
			.where(inArray(messages.id, uniqueMessageIds));
		for (const m of messageRecords) {
			messageConversationMap.set(m.id, m.conversationId);
		}
	}

	return rows.map((r) => {
		const source = r.sourceUserId ? (sourceMap.get(r.sourceUserId) ?? null) : null;
		const discussion = r.discussionId ? (discussionMap.get(r.discussionId) ?? null) : null;
		return {
			id: r.id,
			type: r.type,
			isRead: r.isRead,
			createdAt: r.createdAt,
			sourceUserId: r.sourceUserId,
			sourceDisplayName: source?.displayName ?? null,
			sourceUsername: source?.username ?? null,
			sourceAvatarFileId: source?.avatarFileId ?? null,
			discussionId: r.discussionId,
			discussionTitle: discussion?.title ?? null,
			discussionSlug: discussion?.slug ?? null,
			replyId: r.replyId,
			messageId: r.messageId,
			conversationId: r.messageId ? (messageConversationMap.get(r.messageId) ?? null) : null,
			activityId: r.activityId
		};
	});
}
