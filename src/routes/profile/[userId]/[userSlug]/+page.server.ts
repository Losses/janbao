import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { users, activities, drafts } from '$lib/server/db/schema';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { generateSlug } from '$lib/utils/slug';

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

	// Validate slug matches (slug is for SEO — accept anyway)

	const targetUser = targetUserRecords[0];

	// Validate slug matches (slug is for SEO — accept anyway)
	const expectedSlug = generateSlug(targetUser.username);
	const { userSlug } = event.params;
	if (userSlug !== expectedSlug) {
		// Slug mismatch is accepted — slug is cosmetic for SEO
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
				sql`(${activities.authorId} = ${userId} OR ${activities.recipientId} = ${userId})`
			)
		)
		.orderBy(desc(activities.createdAt))
		.limit(20);

	// 4. Determine if current user is the owner
	const isOwner = currentUser ? currentUser.id === userId : false;

	// 5. Fetch existing draft for directed activity composer
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

	return {
		targetUser,
		activities: profileActivities,
		isOwner,
		activityDraft
	};
};
