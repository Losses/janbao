import { users } from '../schema';
import { eq } from 'drizzle-orm';
import type { D1Db } from '../index';
import type { ProfileHeaderUser, UserInfoSummary } from '$lib/types/api';
import { getInviter } from './invitations';

/**
 * Everything a profile page needs to render its header. `email` is the raw DB
 * value; callers decide whether to expose it based on `showEmail` and the
 * viewer's identity (guests never see it).
 */
export interface ProfileHeaderPayload {
	user: ProfileHeaderUser;
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
			signupTime: users.signupTime,
			lastActiveTime: users.lastActiveTime,
			groupSlug: users.groupSlug,
			viewCount: users.viewCount,
			isStealth: users.isStealth,
			showEmail: users.showEmail,
			email: users.email
		})
		.from(users)
		.where(eq(users.id, targetUserId))
		.limit(1);

	if (rows.length === 0) return null;

	const row = rows[0];
	const { email, ...headerUser } = row;
	const invitedBy = await getInviter(db, targetUserId);

	return {
		user: headerUser,
		invitedBy,
		email
	};
}
