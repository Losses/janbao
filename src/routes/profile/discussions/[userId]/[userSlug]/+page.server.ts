import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getDiscussionsList, getDiscussionsCount } from '$lib/server/db/dao/discussions';
import { parseDiscussionPagination } from '$lib/server/constants';
import { generateSlug } from '$lib/utils/slug';

export const load: PageServerLoad = async (event) => {
	const { userId, userSlug } = event.params;
	const db = event.locals.db;
	const user = event.locals.user;

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

	// Validate slug
	const expectedSlug = generateSlug(targetUser.username);
	if (userSlug !== expectedSlug) {
		// Accept anyway - slug is for SEO
	}

	// 2. Parse pagination
	const { page, limit, offset } = parseDiscussionPagination(event.url, event.platform?.env);

	// 3. Fetch discussions by this user
	const discussionsList = await getDiscussionsList(db, {
		userId: user?.id || null,
		authorId: userId,
		limit,
		offset
	});

	const totalCount = await getDiscussionsCount(db, { authorId: userId });
	const totalPages = Math.ceil(totalCount / limit);

	return {
		targetUser,
		discussions: discussionsList,
		page,
		totalPages,
		totalCount
	};
};
