import type { PageServerLoad } from './$types';
import { getDiscussionsCount, getDiscussionsList } from '$lib/server/db/dao/discussions';
import { loadProfileSubPageContext } from '$lib/server/profile-context';

export const load: PageServerLoad = async (event) => {
	const { db, user, t } = event.locals;
	const ctx = await loadProfileSubPageContext({
		db,
		user,
		params: event.params,
		url: event.url,
		platformEnv: event.platform?.env,
		notFoundText: t.common.notFound
	});

	// Fetch discussions by this user (filtered by category read permissions)
	const discussionsList = await getDiscussionsList(db, {
		userId: user?.id ?? null,
		authorId: ctx.userId,
		limit: ctx.limit,
		offset: ctx.offset,
		groupSlug: ctx.groupSlug
	});

	const totalCount = await getDiscussionsCount(db, {
		authorId: ctx.userId,
		groupSlug: ctx.groupSlug
	});
	const totalPages = Math.ceil(totalCount / ctx.limit);

	return {
		targetUser: ctx.targetUser,
		invitedBy: ctx.invitedBy,
		headerEmail: ctx.headerEmail,
		discussions: discussionsList,
		page: ctx.page,
		totalPages,
		totalCount,
		targetUserGroupSlug: ctx.adminSidebar.groupSlug,
		targetUserEmail: ctx.adminSidebar.email,
		manageableGroups: ctx.adminSidebar.manageableGroups
	};
};
