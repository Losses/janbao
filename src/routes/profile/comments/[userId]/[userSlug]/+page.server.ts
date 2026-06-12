import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getUserComments } from '$lib/server/db/dao/comments';
import { generateSlug } from '$lib/utils/slug';

export const load: PageServerLoad = async (event) => {
	const { userId, userSlug } = event.params;
	const db = event.locals.db;

	// 1. Fetch target user
	const targetUserRecords = await db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarFileId: users.avatarFileId
		})
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);

	if (targetUserRecords.length === 0) {
		error(404, event.locals.t.common.notFound);
	}

	const targetUser = targetUserRecords[0];

	// Slug is cosmetic for SEO — accept regardless of match
	const expectedSlug = generateSlug(targetUser.username);
	if (userSlug !== expectedSlug) {
		// accepted anyway
	}

	// 2. Fetch merged comments (replies + activity comments), sorted chronologically
	const comments = await getUserComments(db, userId);

	return {
		targetUser,
		comments
	};
};
