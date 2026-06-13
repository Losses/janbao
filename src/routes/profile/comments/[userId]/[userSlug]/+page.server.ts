import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getUserComments } from '$lib/server/db/dao/comments';
import { resolveGroupSlug } from '$lib/server/constants';
import { resolveMentions } from '$lib/server/utils/mentions';

export const load: PageServerLoad = async (event) => {
	const { userId } = event.params;
	const db = event.locals.db;
	const user = event.locals.user;
	const groupSlug = resolveGroupSlug(user);

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

	// 2. Fetch merged comments (replies + activity comments), filtered by category permissions
	const comments = await getUserComments(db, userId, groupSlug);

	// 3. Resolve @mentions across comment content for chip rendering
	const mentionedUsers = await resolveMentions(
		comments.map((c) => c.contentJson),
		db
	);

	return {
		targetUser,
		comments,
		mentionedUsers
	};
};
