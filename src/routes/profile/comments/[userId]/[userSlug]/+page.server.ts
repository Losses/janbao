import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getUserComments, getUserCommentsCount } from '$lib/server/db/dao/comments';
import { parseDiscussionPagination, resolveGroupSlug } from '$lib/server/constants';
import { getProfileAdminSidebarData } from '$lib/server/db/dao/admin-permissions';
import { getProfileHeaderPayload } from '$lib/server/db/dao/profile';
import { resolveMentions } from '$lib/server/utils/mentions';

export const load: PageServerLoad = async (event) => {
	const userId = Number(event.params.userId);
	if (Number.isNaN(userId)) {
		error(404, event.locals.t.common.notFound);
	}
	const db = event.locals.db;
	const user = event.locals.user;
	const groupSlug = resolveGroupSlug(user);

	// 1. Fetch target user header data (shared across profile pages)
	const headerPayload = await getProfileHeaderPayload(db, userId);
	if (!headerPayload) {
		error(404, event.locals.t.common.notFound);
	}

	const targetUser = headerPayload.user;
	const invitedBy = headerPayload.invitedBy;
	// Email shown in the public header only when the target opted into showEmail
	// AND the viewer is logged in (guests never see it).
	const headerEmail = targetUser.showEmail && user ? headerPayload.email : null;

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

	const adminSidebar = await getProfileAdminSidebarData(db, user?.groupSlug, user?.id, userId);

	return {
		targetUser,
		invitedBy,
		headerEmail,
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
