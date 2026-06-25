import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import { users } from '$lib/server/db/schema';
import { eq, and, gt, not } from 'drizzle-orm';
import { SYSTEM_USER_ID } from '$lib/server/constants';
import { buildAvatarUrl } from '$lib/utils/image';
import type { RequestHandler } from './$types';
import type { OnlineUser } from '$lib/types/api';

// Active Users Wall endpoint
// Returns users active in the last 10 minutes, excluding stealth mode users and the system user.
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return jsonError(locals.t, 'common.unauthorized', 401);
	}

	const db = locals.db;

	// Threshold: 10 minutes ago as a Date object (Drizzle timestamp mode uses Date)
	const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

	const rows = await db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarFileId: users.avatarFileId,
			avatarContentType: users.avatarContentType
		})
		.from(users)
		.where(
			and(
				eq(users.isStealth, false),
				gt(users.lastActiveTime, tenMinutesAgo),
				not(eq(users.id, SYSTEM_USER_ID))
			)
		)
		.limit(50);

	const onlineUsers: OnlineUser[] = rows.map((r) => ({
		id: r.id,
		username: r.username,
		displayName: r.displayName,
		avatarUrl: buildAvatarUrl(r.id, r.avatarFileId, r.avatarContentType)
	}));

	return json(onlineUsers, {
		headers: {
			'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
		}
	});
};
