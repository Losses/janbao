import type { PageServerLoad } from './$types';
import { activities, users, drafts, activityJoins } from '$lib/server/db/schema';
import { and, isNull, desc, eq, sql, inArray } from 'drizzle-orm';
import { getActivitiesLimit, SYSTEM_USER_ID } from '$lib/server/constants';
import { resolveMentions } from '$lib/server/utils/mentions';
import type { JoinedMember, RecipientInfo } from '$lib/types/api';

export const load: PageServerLoad = async (event) => {
	const db = event.locals.db;
	const platformEnv = event.platform?.env;
	const user = event.locals.user;
	const locale = event.locals.lang;

	// 1. Parse pagination
	const pageParam = event.url.searchParams.get('page');
	let page = pageParam ? parseInt(pageParam, 10) : 1;
	if (isNaN(page) || page < 1) {
		page = 1;
	}

	const limit = getActivitiesLimit(platformEnv);
	const offset = (page - 1) * limit;

	// 2. Fetch root activities (no parentActivityId), excluding deleted, ordered by createdAt DESC
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
		.orderBy(desc(activities.createdAt))
		.limit(limit)
		.offset(offset);

	// 2b. Batch-fetch members of any isJoined activities on this page.
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

	// 4. Fetch recipient display names for directed activities
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

	// 5. Fetch comment counts per activity (batch query)
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

	// 6. Total count for pagination
	const totalResult = await db
		.select({ count: sql<number>`COUNT(*)` })
		.from(activities)
		.where(and(isNull(activities.parentActivityId), isNull(activities.deletedAt)));

	const totalCount = totalResult[0]?.count || 0;
	const totalPages = Math.ceil(totalCount / limit);

	// 7. Fetch existing activity draft if logged in
	let activityDraft: string | null = null;
	if (user) {
		const draftRecords = await db
			.select({ contentJson: drafts.contentJson })
			.from(drafts)
			.where(
				and(
					eq(drafts.authorId, user.id),
					eq(drafts.contextType, 'activity'),
					eq(drafts.contextId, 0)
				)
			)
			.limit(1);

		if (draftRecords.length > 0) {
			activityDraft = draftRecords[0].contentJson;
		}
	}

	// 8. Resolve @mentions across all activity content for chip rendering
	const mentionedUsers = await resolveMentions(
		activityList.map((a) => a.contentJson),
		db
	);

	return {
		activities: activityList.map((a) => ({
			...a,
			recipientDisplayName: a.recipientId
				? recipientMap.get(a.recipientId)?.displayName || null
				: null,
			recipientUsername: a.recipientId ? recipientMap.get(a.recipientId)?.username || null : null,
			commentCount: commentCountMap.get(a.id) || 0,
			joinedMembers: a.isJoined ? (joinedMembersMap.get(a.id) ?? []) : []
		})),
		page,
		totalPages,
		totalCount,
		activityDraft,
		mentionedUsers,
		locale
	};
};
