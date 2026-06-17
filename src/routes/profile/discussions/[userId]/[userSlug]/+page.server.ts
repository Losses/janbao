import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDiscussionsList, getDiscussionsCount } from '$lib/server/db/dao/discussions';
import { parseDiscussionPagination, resolveGroupSlug } from '$lib/server/constants';
import { getProfileAdminSidebarData } from '$lib/server/db/dao/admin-permissions';
import { getProfileHeaderPayload } from '$lib/server/db/dao/profile';

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

	// 2. Parse pagination
	const { page, limit, offset } = parseDiscussionPagination(event.url, event.platform?.env);

	// 3. Fetch discussions by this user (filtered by category read permissions)
	const discussionsList = await getDiscussionsList(db, {
		userId: user?.id ?? null,
		authorId: userId,
		limit,
		offset,
		groupSlug
	});

	const totalCount = await getDiscussionsCount(db, { authorId: userId, groupSlug });
	const totalPages = Math.ceil(totalCount / limit);

	const adminSidebar = await getProfileAdminSidebarData(db, user?.groupSlug, user?.id, userId);

	return {
		targetUser,
		invitedBy,
		headerEmail,
		discussions: discussionsList,
		page,
		totalPages,
		totalCount,
		targetUserGroupSlug: adminSidebar.groupSlug,
		targetUserEmail: adminSidebar.email,
		manageableGroups: adminSidebar.manageableGroups
	};
};
