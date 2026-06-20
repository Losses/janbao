/**
 * Activity feed DAO. `loadActivityPage` is the single source for the /activity
 * feed query, shared by the activity route load (paginated via ?page) and the
 * mobile tab-pager layout load (eager page 1). Extracted from the route load so
 * the pager can mount all three tabs without duplicating the query body.
 */
import { activities, users, drafts, activityJoins } from '../schema';
import { and, isNull, desc, eq, sql, inArray } from 'drizzle-orm';
import type { D1Db } from '../index';
import { getActivitiesLimit, SYSTEM_USER_ID } from '$lib/server/constants';
import { resolveMentions } from '$lib/server/utils/mentions';
import type { ActivityListItem, JoinedMember, RecipientInfo } from '$lib/types/api';
import type { MentionedUsersMap } from '$lib/types/mentions';

interface LoadActivityPageOptions {
	userId: number | null;
	page: number;
	platformEnv: App.Platform['env'] | undefined;
}

export interface ActivityPageResult {
	activities: ActivityListItem[];
	page: number;
	totalPages: number;
	totalCount: number;
	activityDraft: string | null;
	mentionedUsers: MentionedUsersMap;
}

export async function loadActivityPage(
	db: D1Db,
	options: LoadActivityPageOptions
): Promise<ActivityPageResult> {
	const { userId, page, platformEnv } = options;
	const limit = getActivitiesLimit(platformEnv);
	const offset = (page - 1) * limit;

	// 1. Root activities (no parentActivityId), excluding deleted, ordered like Vanilla's feed.
	const activityList = await db
		.select({
			id: activities.id,
			authorId: activities.authorId,
			recipientId: activities.recipientId,
			contentJson: activities.contentJson,
			createdAt: activities.createdAt,
			isJoined: activities.isJoined,
			authorDisplayName: users.displayName,
			authorUsername: users.username,
			authorAvatarFileId: users.avatarFileId
		})
		.from(activities)
		.innerJoin(users, eq(activities.authorId, users.id))
		.where(and(isNull(activities.parentActivityId), isNull(activities.deletedAt)))
		.orderBy(
			sql`COALESCE(${activities.updatedAt}, ${activities.createdAt}) DESC`,
			desc(activities.id)
		)
		.limit(limit)
		.offset(offset);

	// 2. Batch-fetch members of any isJoined activities on this page.
	const joinedActivityIds = activityList.filter((a) => a.isJoined).map((a) => a.id);
	const joinedMembersMap = new Map<number, JoinedMember[]>();
	if (joinedActivityIds.length > 0) {
		const joinRows = await db
			.select({
				activityId: activityJoins.activityId,
				userId: activityJoins.userId,
				displayName: users.displayName,
				username: users.username,
				avatarFileId: users.avatarFileId
			})
			.from(activityJoins)
			.innerJoin(users, eq(activityJoins.userId, users.id))
			.where(inArray(activityJoins.activityId, joinedActivityIds))
			.orderBy(activityJoins.joinedAt);
		for (const r of joinRows) {
			const arr = joinedMembersMap.get(r.activityId) ?? [];
			arr.push({
				userId: r.userId,
				displayName: r.displayName,
				username: r.username,
				avatarFileId: r.avatarFileId
			});
			joinedMembersMap.set(r.activityId, arr);
		}
	}

	// 3. Recipient display names for directed activities.
	const recipientIds = activityList
		.map((a) => a.recipientId)
		.filter((id): id is number => id !== null && id !== SYSTEM_USER_ID);
	const recipientMap = new Map<number, RecipientInfo>();
	if (recipientIds.length > 0) {
		const uniqueIds = [...new Set(recipientIds)];
		const recipients = await db
			.select({ id: users.id, displayName: users.displayName, username: users.username })
			.from(users)
			.where(inArray(users.id, uniqueIds));
		for (const r of recipients) {
			recipientMap.set(r.id, { displayName: r.displayName, username: r.username });
		}
	}

	// 4. Comment counts per activity (batch query).
	const activityIds = activityList.map((a) => a.id);
	const commentCountMap = new Map<number, number>();
	if (activityIds.length > 0) {
		const commentCounts = await db
			.select({
				parentActivityId: activities.parentActivityId,
				count: sql<number>`COUNT(*)`
			})
			.from(activities)
			.where(and(inArray(activities.parentActivityId, activityIds), isNull(activities.deletedAt)))
			.groupBy(activities.parentActivityId);
		for (const cc of commentCounts) {
			if (cc.parentActivityId) {
				commentCountMap.set(cc.parentActivityId, cc.count);
			}
		}
	}

	// 5. Total count for pagination.
	const totalResult = await db
		.select({ count: sql<number>`COUNT(*)` })
		.from(activities)
		.where(and(isNull(activities.parentActivityId), isNull(activities.deletedAt)));
	const totalCount = totalResult[0]?.count || 0;
	const totalPages = Math.ceil(totalCount / limit);

	// 6. Existing activity draft (logged-in only).
	let activityDraft: string | null = null;
	if (userId !== null) {
		const draftRecords = await db
			.select({ contentJson: drafts.contentJson })
			.from(drafts)
			.where(
				and(
					eq(drafts.authorId, userId),
					eq(drafts.contextType, 'activity'),
					eq(drafts.contextId, 0)
				)
			)
			.limit(1);
		if (draftRecords.length > 0) {
			activityDraft = draftRecords[0].contentJson;
		}
	}

	// 7. Resolve @mentions across all activity content for chip rendering.
	const mentionedUsers = await resolveMentions(
		activityList.map((a) => a.contentJson),
		db
	);

	const mapped: ActivityListItem[] = activityList.map((a) => ({
		id: a.id,
		authorId: a.authorId,
		authorDisplayName: a.authorDisplayName,
		authorUsername: a.authorUsername,
		authorAvatarFileId: a.authorAvatarFileId,
		recipientId: a.recipientId,
		recipientDisplayName: a.recipientId
			? (recipientMap.get(a.recipientId)?.displayName ?? null)
			: null,
		recipientUsername: a.recipientId ? (recipientMap.get(a.recipientId)?.username ?? null) : null,
		contentJson: a.contentJson,
		createdAt: a.createdAt,
		commentCount: commentCountMap.get(a.id) || 0,
		isJoined: a.isJoined,
		joinedMembers: a.isJoined ? (joinedMembersMap.get(a.id) ?? []) : []
	}));

	return { activities: mapped, page, totalPages, totalCount, activityDraft, mentionedUsers };
}
