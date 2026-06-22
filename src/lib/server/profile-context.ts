import { error } from '@sveltejs/kit';
import { parseDiscussionPagination, resolveGroupSlug } from '$lib/server/constants';
import type { D1Db } from '$lib/server/db';
import {
	getProfileAdminSidebarData,
	type ProfileAdminSidebarData
} from '$lib/server/db/dao/admin-permissions';
import { getProfileHeaderPayload, type ProfileHeaderTarget } from '$lib/server/db/dao/profile';
import type { UserInfoSummary } from '$lib/types/api';

interface ProfileSubPageRouteParams {
	userId: string;
}

interface ProfileSubPageInput {
	db: D1Db;
	user: App.Locals['user'];
	params: ProfileSubPageRouteParams;
	url: URL;
	platformEnv: App.Platform['env'] | undefined;
	notFoundText: string;
}

export interface ProfileSubPageContext {
	userId: number;
	groupSlug: string;
	// targetUser carries the server-built avatarUrl (see ProfileHeaderTarget).
	targetUser: ProfileHeaderTarget;
	invitedBy: UserInfoSummary | null;
	headerEmail: string | null;
	page: number;
	limit: number;
	offset: number;
	adminSidebar: ProfileAdminSidebarData;
}

/**
 * Shared preamble for profile sub-page loaders (comments, discussions, ...):
 * resolve the target id, load the profile header, parse pagination, and gather
 * the admin-sidebar payload. Throws a SvelteKit 404 (`error`) when the id is
 * missing/non-numeric or the target user does not exist, so each loader only
 * has to run its own resource query and shape the return value.
 */
export async function loadProfileSubPageContext(
	input: ProfileSubPageInput
): Promise<ProfileSubPageContext> {
	const userId = Number(input.params.userId);
	if (Number.isNaN(userId)) {
		error(404, input.notFoundText);
	}

	const headerPayload = await getProfileHeaderPayload(input.db, userId);
	if (!headerPayload) {
		error(404, input.notFoundText);
	}

	const targetUser = headerPayload.user;
	// Email shows in the public header only when the target opted into showEmail
	// AND the viewer is logged in (guests never see it).
	const headerEmail = targetUser.showEmail && input.user ? headerPayload.email : null;

	const { page, limit, offset } = parseDiscussionPagination(input.url, input.platformEnv);

	const adminSidebar = await getProfileAdminSidebarData(
		input.db,
		input.user?.groupSlug,
		input.user?.id,
		userId
	);

	return {
		userId,
		groupSlug: resolveGroupSlug(input.user),
		targetUser,
		invitedBy: headerPayload.invitedBy,
		headerEmail,
		page,
		limit,
		offset,
		adminSidebar
	};
}
