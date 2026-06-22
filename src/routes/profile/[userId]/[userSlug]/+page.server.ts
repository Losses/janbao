import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { users, activities, drafts, activityJoins } from '$lib/server/db/schema';
import { eq, and, isNull, desc, sql, or, inArray } from 'drizzle-orm';
import { generateSlug } from '$lib/utils/slug';
import { buildAvatarUrl } from '$lib/utils/image';
import { BOOTSTRAP_ADMIN_ID, SYSTEM_USER_ID, getAllowGuestActivity } from '$lib/server/constants';
import { resolveMentions } from '$lib/server/utils/mentions';
import { getProfileHeaderPayload } from '$lib/server/db/dao/profile';
import { authorPreviewColumns } from '$lib/server/db/dao/user-preview';
import { listManageableUserGroups } from '$lib/server/db/dao/admin-permissions';
import type { JoinedMember, RecipientInfo } from '$lib/types/api';

export const load: PageServerLoad = async (event) => {
	const userId = Number(event.params.userId);
	if (Number.isNaN(userId)) {
		error(404, event.locals.t.common.notFound);
	}
	const db = event.locals.db;
	const currentUser = event.locals.user;

	// 1. Fetch target user header data (shared across profile pages)
	const headerPayload = await getProfileHeaderPayload(db, userId);
	if (!headerPayload) {
		error(404, event.locals.t.common.notFound);
	}

	const targetUser = headerPayload.user;
	const invitedBy = headerPayload.invitedBy;

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

	// Email shown in the public header only when the target opted into showEmail
	// AND the viewer is logged in (guests never see it).
	const headerEmail = targetUser.showEmail && currentUser ? headerPayload.email : null;

	const allowGuestActivity = getAllowGuestActivity(event.platform?.env);

	// 4. Fetch profile activities (directed to this user OR authored by this user,
	//    OR isJoined activities this user is a member of), no parent.
	const profileActivities =
		!currentUser && !allowGuestActivity
			? []
			: await db
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

	// 9b. Fetch manageable groups for admin sidebar controls. The bootstrap
	// super-admin additionally sees the reserved `admin` group so promotion is a
	// dropdown option (peer admins never see it).
	const manageableGroups =
		currentUser?.groupSlug === 'admin'
			? await listManageableUserGroups(db, {
					includeAdmin: currentUser.id === BOOTSTRAP_ADMIN_ID
				})
			: [];

	// The sidebar's reset-link copy sentence needs the raw email, exposed only to
	// admins. Reuse the value already fetched for the header rather than re-querying.
	const targetUserEmail = currentUser?.groupSlug === 'admin' ? headerPayload.email : null;

	return {
		targetUser,
		headerEmail,
		// Only expose the target user's email to admins (for the reset-link copy sentence).
		targetUserEmail,
		invitedBy,
		activities: profileActivities.map((a) => ({
			id: a.id,
			authorId: a.authorId,
			authorDisplayName: a.authorDisplayName,
			authorUsername: a.authorUsername,
			authorAvatarUrl: buildAvatarUrl(a.authorId, a.authorAvatarFileId, a.authorAvatarContentType),
			recipientId: a.recipientId,
			recipientDisplayName: a.recipientId
				? recipientMap.get(a.recipientId)?.displayName || null
				: null,
			recipientUsername: a.recipientId ? recipientMap.get(a.recipientId)?.username || null : null,
			contentJson: a.contentJson,
			createdAt: a.createdAt,
			isJoined: a.isJoined,
			commentCount: commentCountMap.get(a.id) || 0,
			joinedMembers: a.isJoined ? (joinedMembersMap.get(a.id) ?? []) : []
		})),
		isOwner,
		activityDraft,
		mentionedUsers,
		manageableGroups
	};
};
