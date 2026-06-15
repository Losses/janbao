import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { users, activities, drafts, activityJoins } from '$lib/server/db/schema';
import { eq, and, isNull, desc, sql, or, inArray } from 'drizzle-orm';
import { generateSlug } from '$lib/utils/slug';
import { SYSTEM_USER_ID } from '$lib/server/constants';
import { resolveMentions } from '$lib/server/utils/mentions';
import { getInviter } from '$lib/server/db/dao/invitations';
import type { JoinedMember, RecipientInfo } from '$lib/types/api';

export const load: PageServerLoad = async (event) => {
	const userId = Number(event.params.userId);
	if (Number.isNaN(userId)) {
		error(404, event.locals.t.common.notFound);
	}
	const db = event.locals.db;
	const currentUser = event.locals.user;

	// 1. Fetch target user
	const targetUserRecords = await db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			bio: users.bio,
			avatarFileId: users.avatarFileId,
			signupTime: users.signupTime,
			lastActiveTime: users.lastActiveTime,
			groupSlug: users.groupSlug,
			viewCount: users.viewCount,
			isStealth: users.isStealth
		})
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);

	if (targetUserRecords.length === 0) {
		error(404, event.locals.t.common.notFound);
	}

	const targetUser = targetUserRecords[0];

	// Validate slug matches (slug is for SEO - accept anyway)
	const expectedSlug = generateSlug(targetUser.username);
	const { userSlug } = event.params;
	if (userSlug !== expectedSlug) {
		// Slug mismatch is accepted - slug is cosmetic for SEO
	}

	// 2. Increment view count (exclude self-visits)
	if (!currentUser || currentUser.id !== userId) {
		await db
			.update(users)
			.set({ viewCount: sql`${users.viewCount} + 1` })
			.where(eq(users.id, userId));

		// Reflect incremented count in returned data
		targetUser.viewCount += 1;
	}

	// 3. Resolve who invited this user (null if joined without an invitation)
	const invitedBy = await getInviter(db, userId);

	// 4. Fetch profile activities (directed to this user OR authored by this user,
	//    OR isJoined activities this user is a member of), no parent.
	const profileActivities = await db
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
		.where(
			and(
				isNull(activities.deletedAt),
				isNull(activities.parentActivityId),
				or(
					eq(activities.authorId, userId),
					eq(activities.recipientId, userId),
					// isJoined activities have author=SYSTEM_USER_ID; surface the ones
					// where this profile's user is a member.
					sql`(${activities.isJoined} = 1 AND EXISTS (SELECT 1 FROM activity_joins aj WHERE aj.activity_id = ${activities.id} AND aj.user_id = ${userId}))`
				)
			)
		)
		.orderBy(
			// Vanilla surfaces an activity by its last-updated time (a comment bumps
			// the parent status), not its insertion time. updatedAt holds that bumped
			// time; fall back to createdAt for rows without it. The id tiebreaker
			// keeps same-day activities (midnight-truncated timestamps from the
			// date-only source) in newest-first order.
			sql`COALESCE(${activities.updatedAt}, ${activities.createdAt}) DESC`,
			desc(activities.id)
		)
		.limit(20);

	// 4b. Batch-fetch members of any isJoined activities on this profile feed.
	const joinedActivityIds = profileActivities.filter((a) => a.isJoined).map((a) => a.id);
	const joinedMembersMap = new Map<number, JoinedMember[]>();
	if (joinedActivityIds.length > 0) {
		const joinRows = await db
			.select({
				activityId: activityJoins.activityId,
				userId: activityJoins.userId,
				displayName: users.displayName,
				username: users.username
			})
			.from(activityJoins)
			.innerJoin(users, eq(activityJoins.userId, users.id))
			.where(inArray(activityJoins.activityId, joinedActivityIds))
			.orderBy(activityJoins.joinedAt);
		for (const r of joinRows) {
			const arr = joinedMembersMap.get(r.activityId) ?? [];
			arr.push({ userId: r.userId, displayName: r.displayName, username: r.username });
			joinedMembersMap.set(r.activityId, arr);
		}
	}

	// 5. Batch-fetch recipient display names for directed activities
	const recipientIds = profileActivities
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

	// 6. Batch-fetch comment counts per activity
	const activityIds = profileActivities.map((a) => a.id);
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

	// 7. Determine if current user is the owner
	const isOwner = currentUser ? currentUser.id === userId : false;

	// 8. Fetch existing draft for directed activity composer
	let activityDraft: string | null = null;
	if (currentUser) {
		const draftRecords = await db
			.select({ contentJson: drafts.contentJson })
			.from(drafts)
			.where(
				and(
					eq(drafts.authorId, currentUser.id),
					eq(drafts.contextType, 'activity'),
					eq(drafts.contextId, userId)
				)
			)
			.limit(1);

		if (draftRecords.length > 0) {
			activityDraft = draftRecords[0].contentJson;
		}
	}

	// 9. Resolve @mentions across profile activity content for chip rendering
	const mentionedUsers = await resolveMentions(
		profileActivities.map((a) => a.contentJson),
		db
	);

	return {
		targetUser,
		invitedBy,
		activities: profileActivities.map((a) => ({
			...a,
			recipientDisplayName: a.recipientId
				? recipientMap.get(a.recipientId)?.displayName || null
				: null,
			recipientUsername: a.recipientId ? recipientMap.get(a.recipientId)?.username || null : null,
			commentCount: commentCountMap.get(a.id) || 0,
			joinedMembers: a.isJoined ? (joinedMembersMap.get(a.id) ?? []) : []
		})),
		isOwner,
		activityDraft,
		mentionedUsers,
		locale: event.locals.lang
	};
};
