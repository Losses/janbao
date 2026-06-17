import type { PageServerLoad } from './$types';
import { getUserComments, getUserCommentsCount } from '$lib/server/db/dao/comments';
import { loadProfileSubPageContext } from '$lib/server/profile-context';
import { resolveMentions } from '$lib/server/utils/mentions';

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

	// Fetch paginated replies (excluding OP, filtered by category permissions)
	const comments = await getUserComments(db, {
		userId: ctx.userId,
		groupSlug: ctx.groupSlug,
		limit: ctx.limit,
		offset: ctx.offset
	});

	const totalCount = await getUserCommentsCount(db, {
		userId: ctx.userId,
		groupSlug: ctx.groupSlug
	});
	const totalPages = Math.ceil(totalCount / ctx.limit);

	// Resolve @mentions across this page's comment content for chip rendering
	const mentionedUsers = await resolveMentions(
		comments.map((c) => c.contentJson),
		db
	);

	return {
		targetUser: ctx.targetUser,
		invitedBy: ctx.invitedBy,
		headerEmail: ctx.headerEmail,
		comments,
		mentionedUsers,
		page: ctx.page,
		totalPages,
		totalCount,
		targetUserGroupSlug: ctx.adminSidebar.groupSlug,
		targetUserEmail: ctx.adminSidebar.email,
		manageableGroups: ctx.adminSidebar.manageableGroups
	};
};
