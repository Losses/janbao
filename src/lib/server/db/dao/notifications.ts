import { notifications, users, discussions, categories } from '../schema';
import { eq, and, desc, inArray, isNull, sql } from 'drizzle-orm';
import type { D1Db } from '../index';
import type { NotificationItem } from '$lib/types/api';
import { buildAvatarUrl } from '$lib/utils/image';

interface SourceUserInfo {
	displayName: string;
	username: string;
	avatarFileId: string | null;
	avatarContentType: string | null;
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
	userId: number,
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
			activityId: notifications.activityId
		})
		.from(notifications)
		.where(eq(notifications.userId, userId))
		.orderBy(desc(notifications.createdAt))
		.limit(limit);

	// Batch-resolve source user display info
	const sourceIds = rows.map((r) => r.sourceUserId).filter((id): id is number => id !== null);
	const sourceMap = new Map<number, SourceUserInfo>();
	if (sourceIds.length > 0) {
		const uniqueSourceIds = [...new Set(sourceIds)];
		const sourceUsers = await db
			.select({
				id: users.id,
				displayName: users.displayName,
				username: users.username,
				avatarFileId: users.avatarFileId,
				avatarContentType: users.avatarContentType
			})
			.from(users)
			.where(inArray(users.id, uniqueSourceIds));
		for (const u of sourceUsers) {
			sourceMap.set(u.id, {
				displayName: u.displayName,
				username: u.username,
				avatarFileId: u.avatarFileId,
				avatarContentType: u.avatarContentType
			});
		}
	}

	// Batch-resolve referenced discussion titles/slugs
	const discussionIds = rows.map((r) => r.discussionId).filter((id): id is number => id !== null);
	const discussionMap = new Map<number, DiscussionInfo>();
	if (discussionIds.length > 0) {
		const uniqueDiscussionIds = [...new Set(discussionIds)];
		// Resolve titles only for live discussions in enabled categories; a
		// notification referencing a soft-deleted or now-disabled-category
		// discussion yields a null title (the UI already null-guards) rather than
		// leaking its content.
		const discussionRecords = await db
			.select({ id: discussions.id, title: discussions.title, slug: discussions.slug })
			.from(discussions)
			.innerJoin(categories, eq(discussions.categorySlug, categories.slug))
			.where(
				and(
					inArray(discussions.id, uniqueDiscussionIds),
					isNull(discussions.deletedAt),
					isNull(categories.disabledAt)
				)
			);
		for (const d of discussionRecords) {
			discussionMap.set(d.id, { title: d.title, slug: d.slug });
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
			sourceAvatarUrl:
				source && r.sourceUserId !== null
					? buildAvatarUrl(r.sourceUserId, source.avatarFileId, source.avatarContentType)
					: null,
			discussionId: r.discussionId,
			discussionTitle: discussion?.title ?? null,
			discussionSlug: discussion?.slug ?? null,
			replyId: r.replyId,
			activityId: r.activityId
		};
	});
}

/**
 * Count the active user's unread notifications. Served by the
 * `notifications_user_read_idx` index on (userId, isRead). Used by the root
 * layout load to render the notification icon badge; cheap enough to run on
 * every navigation.
 */
export async function countUnreadNotifications(db: D1Db, userId: number): Promise<number> {
	const rows = await db
		.select({ count: sql<number>`COUNT(*)` })
		.from(notifications)
		.where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
	return rows[0]?.count ?? 0;
}
