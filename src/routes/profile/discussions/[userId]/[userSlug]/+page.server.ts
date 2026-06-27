import type { PageServerLoad } from './$types';
import { loadDiscussionsPage } from '$lib/server/db/dao/discussions';
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

	// Fetch discussions by this user (filtered by category read permissions).
	// loadDiscussionsPage runs the list and total count concurrently and resolves
	// the readable-category slugs once for both, instead of two sequential calls.
	const { discussions, totalPages, totalCount } = await loadDiscussionsPage(db, {
		userId: user?.id ?? null,
		authorId: ctx.userId,
		limit: ctx.limit,
		offset: ctx.offset,
		groupSlug: ctx.groupSlug
	});

	return {
		targetUser: ctx.targetUser,
		// The header shows "<user> - Discussions" in deep-page mode.
		headerTitle: `${ctx.targetUser.displayName} - ${t.profile.discussions}`,
		invitedBy: ctx.invitedBy,
		headerEmail: ctx.headerEmail,
		discussions,
		page: ctx.page,
		totalPages,
		totalCount,
		targetUserGroupSlug: ctx.adminSidebar.groupSlug,
		targetUserEmail: ctx.adminSidebar.email,
		manageableGroups: ctx.adminSidebar.manageableGroups
	};
};
