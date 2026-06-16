import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getUserComments, getUserCommentsCount } from '$lib/server/db/dao/comments';
import { parseDiscussionPagination, resolveGroupSlug } from '$lib/server/constants';
import { getProfileAdminSidebarData } from '$lib/server/db/dao/admin-permissions';
import { resolveMentions } from '$lib/server/utils/mentions';

export const load: PageServerLoad = async (event) => {
	const userId = Number(event.params.userId);
	if (Number.isNaN(userId)) {
		error(404, event.locals.t.common.notFound);
	}
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

	// 2. Parse pagination (?page=N, matching profile/discussions)
	const { page, limit, offset } = parseDiscussionPagination(event.url, event.platform?.env);

	// 3. Fetch paginated replies (excluding OP, filtered by category permissions)
	const comments = await getUserComments(db, { userId, groupSlug, limit, offset });

	const totalCount = await getUserCommentsCount(db, { userId, groupSlug });
	const totalPages = Math.ceil(totalCount / limit);

	// 4. Resolve @mentions across this page's comment content for chip rendering
	const mentionedUsers = await resolveMentions(
		comments.map((c) => c.contentJson),
		db
	);

	const adminSidebar = await getProfileAdminSidebarData(db, user?.groupSlug, userId);

	return {
		targetUser,
		comments,
		mentionedUsers,
		page,
		totalPages,
		totalCount,
		targetUserGroupSlug: adminSidebar.groupSlug,
		targetUserEmail: adminSidebar.email,
		manageableGroups: adminSidebar.manageableGroups
	};
};
