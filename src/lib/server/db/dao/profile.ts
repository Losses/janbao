import { userGroups, users } from '../schema';
import { eq } from 'drizzle-orm';
import type { D1Db } from '../index';
import type { ProfileHeaderUser, UserInfoSummary } from '$lib/types/api';
import { buildAvatarUrl } from '$lib/utils/image';
import { getInviter } from './invitations';

/**
 * ProfileHeaderUser extended with the server-built avatarUrl. The shared
 * ProfileHeaderUser type in $lib/types/api still carries the raw avatarFileId
 * because api.ts is shared with other call paths; this DAO is the only place
 * that adds the derived URL, so callers should read `avatarUrl` here rather
 * than reaching for the raw column.
 */
export interface ProfileHeaderTarget extends ProfileHeaderUser {
	avatarUrl: string | null;
}

/**
 * Everything a profile page needs to render its header. `email` is the raw DB
 * value; callers decide whether to expose it based on `showEmail` and the
 * viewer's identity (guests never see it).
 */
export interface ProfileHeaderPayload {
	user: ProfileHeaderTarget;
	invitedBy: UserInfoSummary | null;
	email: string;
}

/**
 * Fetch the target user's header fields, their raw email, and who invited them.
 * Returns `null` when the user does not exist so the caller can map it to a 404.
 */
export async function getProfileHeaderPayload(
	db: D1Db,
	targetUserId: number
): Promise<ProfileHeaderPayload | null> {
	const rows = await db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			bio: users.bio,
			avatarFileId: users.avatarFileId,
			avatarContentType: users.avatarContentType,
			signupTime: users.signupTime,
			lastActiveTime: users.lastActiveTime,
			groupSlug: users.groupSlug,
			groupTitle: userGroups.title,
			viewCount: users.viewCount,
			isStealth: users.isStealth,
			showEmail: users.showEmail,
			email: users.email
		})
		.from(users)
		.leftJoin(userGroups, eq(users.groupSlug, userGroups.slug))
		.where(eq(users.id, targetUserId))
		.limit(1);

	if (rows.length === 0) return null;

	const row = rows[0];
	const { email, groupTitle, avatarFileId, avatarContentType, id, ...headerUser } = row;
	const invitedBy = await getInviter(db, targetUserId);
	const avatarUrl = buildAvatarUrl(id, avatarFileId, avatarContentType);

	return {
		// Fall back to the slug if the group row is somehow missing (orphaned
		// FK) so the header always renders a value rather than `null`.
		user: {
			...headerUser,
			id,
			avatarUrl,
			groupTitle: groupTitle ?? headerUser.groupSlug
		},
		invitedBy,
		email
	};
}
