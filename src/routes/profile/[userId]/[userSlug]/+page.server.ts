import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { users, activities, drafts } from '$lib/server/db/schema';
import { eq, and, isNull, desc, sql, or, inArray } from 'drizzle-orm';
import { generateSlug } from '$lib/utils/slug';
import { SYSTEM_USER_ID } from '$lib/server/constants';
import { resolveMentions } from '$lib/server/utils/mentions';
import type { RecipientInfo } from '$lib/types/api';

export const load: PageServerLoad = async (event) => {
	const { userId } = event.params;
	const db = event.locals.db;
	const currentUser = event.locals.user;

	// 1. Fetch target user
	const targetUserRecords = await db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
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

	// 3. Fetch profile activities (directed to this user OR authored by this user, no parent)
	const profileActivities = await db
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
		.where(
			and(
				isNull(activities.deletedAt),
				isNull(activities.parentActivityId),
				or(eq(activities.authorId, userId), eq(activities.recipientId, userId))
			)
		)
		.orderBy(desc(activities.createdAt))
		.limit(20);

	// 4. Batch-fetch recipient display names for directed activities
	const recipientIds = profileActivities
		.map((a) => a.recipientId)
		.filter((id): id is string => id !== null && id !== SYSTEM_USER_ID);

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

	// 5. Determine if current user is the owner
	const isOwner = currentUser ? currentUser.id === userId : false;

	// 6. Fetch existing draft for directed activity composer
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

	// 7. Resolve @mentions across profile activity content for chip rendering
	const mentionedUsers = await resolveMentions(
		profileActivities.map((a) => a.contentJson),
		db
	);

	return {
		targetUser,
		activities: profileActivities.map((a) => ({
			...a,
			recipientDisplayName: a.recipientId
				? recipientMap.get(a.recipientId)?.displayName || null
				: null,
			recipientUsername: a.recipientId ? recipientMap.get(a.recipientId)?.username || null : null
		})),
		isOwner,
		activityDraft,
		mentionedUsers
	};
};
