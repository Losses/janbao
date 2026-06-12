import type { PageServerLoad } from './$types';
import { activities, users, drafts } from '$lib/server/db/schema';
import { and, isNull, desc, eq, sql, inArray } from 'drizzle-orm';
import { checkAndCreateWelcomePost } from '$lib/server/db/welcome';
import { getActivitiesLimit, SYSTEM_USER_ID } from '$lib/server/constants';

export const load: PageServerLoad = async (event) => {
	const db = event.locals.db;
	const platformEnv = event.platform?.env;
	const user = event.locals.user;

	// 1. Daily Welcome Post Check (Runs on activity square access)
	await checkAndCreateWelcomePost(db, platformEnv);

	// 2. Parse pagination
	const pageParam = event.url.searchParams.get('page');
	let page = pageParam ? parseInt(pageParam, 10) : 1;
	if (isNaN(page) || page < 1) {
		page = 1;
	}

	const limit = getActivitiesLimit(platformEnv);
	const offset = (page - 1) * limit;

	// 3. Fetch root activities (no parentActivityId), excluding deleted, ordered by createdAt DESC
	const activityList = await db
		.select({
			id: activities.id,
			authorId: activities.authorId,
			recipientId: activities.recipientId,
			contentJson: activities.contentJson,
			createdAt: activities.createdAt,
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

	// 4. Fetch recipient display names for directed activities
	const recipientIds = activityList
		.map((a) => a.recipientId)
		.filter((id): id is string => id !== null && id !== SYSTEM_USER_ID);

	interface RecipientInfo {
		displayName: string;
		username: string;
	}

	const recipientMap = new Map<string, RecipientInfo>();
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
	const commentCountMap = new Map<string, number>();

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
					eq(drafts.contextId, 'new')
				)
			)
			.limit(1);

		if (draftRecords.length > 0) {
			activityDraft = draftRecords[0].contentJson;
		}
	}

	return {
		activities: activityList.map((a) => ({
			...a,
			recipientDisplayName: a.recipientId
				? recipientMap.get(a.recipientId)?.displayName || null
				: null,
			recipientUsername: a.recipientId ? recipientMap.get(a.recipientId)?.username || null : null,
			commentCount: commentCountMap.get(a.id) || 0
		})),
		page,
		totalPages,
		totalCount,
		activityDraft
	};
};
