/**
 * Activity feed DAO. `loadActivityPage` is the single source for the /activity
 * feed query, shared by the activity route load (paginated via ?page) and the
 * mobile tab-pager layout load (eager page 1). Extracted from the route load so
 * the pager can mount all three tabs without duplicating the query body.
 */
import { activities, users, drafts, activityJoins } from '../schema';
import { and, isNull, desc, asc, eq, sql, inArray } from 'drizzle-orm';
import type { D1Db } from '../index';
import { getActivitiesLimit } from '$lib/server/constants';
import { resolveMentions } from '$lib/server/utils/mentions';
import { authorPreviewColumns } from './user-preview';
import { buildAvatarUrl } from '$lib/utils/image';
import { isRealUserId } from '$lib/utils/user';
import type {
	ActivityListItem,
	ActivityCommentItem,
	JoinedMember,
	RecipientInfo
} from '$lib/types/api';
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
			...authorPreviewColumns
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
				avatarFileId: users.avatarFileId,
				avatarContentType: users.avatarContentType
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
				avatarUrl: buildAvatarUrl(r.userId, r.avatarFileId, r.avatarContentType)
			});
			joinedMembersMap.set(r.activityId, arr);
		}
	}

	// 3. Recipient display names for directed activities.
	const recipientIds = activityList
		.map((a) => a.recipientId)
		.filter((id): id is number => isRealUserId(id));
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

	// 4. Comments for every activity on this page (one batch query), bundled so
	// the feed renders them inline without a per-row fetch. commentCount is
	// derived from this map, so no separate COUNT query is needed.
	const activityIds = activityList.map((a) => a.id);
	const commentsMap = new Map<number, ActivityCommentItem[]>();
	if (activityIds.length > 0) {
		const commentRows = await db
			.select({
				parentActivityId: activities.parentActivityId,
				id: activities.id,
				authorId: activities.authorId,
				contentJson: activities.contentJson,
				createdAt: activities.createdAt,
				...authorPreviewColumns
			})
			.from(activities)
			.innerJoin(users, eq(activities.authorId, users.id))
			.where(and(inArray(activities.parentActivityId, activityIds), isNull(activities.deletedAt)))
			.orderBy(asc(activities.parentActivityId), asc(activities.createdAt));
		for (const c of commentRows) {
			if (c.parentActivityId == null) continue;
			const arr = commentsMap.get(c.parentActivityId) ?? [];
			arr.push({
				id: c.id,
				authorId: c.authorId,
				contentJson: c.contentJson,
				createdAt: c.createdAt,
				authorDisplayName: c.authorDisplayName,
				authorUsername: c.authorUsername,
				authorAvatarUrl: buildAvatarUrl(c.authorId, c.authorAvatarFileId, c.authorAvatarContentType)
			});
			commentsMap.set(c.parentActivityId, arr);
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
		authorAvatarUrl: buildAvatarUrl(a.authorId, a.authorAvatarFileId, a.authorAvatarContentType),
		recipientId: a.recipientId,
		recipientDisplayName: isRealUserId(a.recipientId)
			? (recipientMap.get(a.recipientId)?.displayName ?? null)
			: null,
		recipientUsername: isRealUserId(a.recipientId)
			? (recipientMap.get(a.recipientId)?.username ?? null)
			: null,
		contentJson: a.contentJson,
		createdAt: a.createdAt,
		commentCount: commentsMap.get(a.id)?.length ?? 0,
		comments: commentsMap.get(a.id) ?? [],
		isJoined: a.isJoined,
		joinedMembers: a.isJoined ? (joinedMembersMap.get(a.id) ?? []) : []
	}));

	return { activities: mapped, page, totalPages, totalCount, activityDraft, mentionedUsers };
}
