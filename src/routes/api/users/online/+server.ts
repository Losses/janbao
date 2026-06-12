import { json } from '@sveltejs/kit';
import { users } from '$lib/server/db/schema';
import { eq, and, gt, not } from 'drizzle-orm';
import { SYSTEM_USER_ID } from '$lib/server/constants';
import type { RequestHandler } from './$types';

// Active Users Wall endpoint
// Returns users active in the last 10 minutes, excluding stealth mode users and the system user.
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const db = locals.db;

	// Threshold: 10 minutes ago as a Date object (Drizzle timestamp mode uses Date)
	const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

	const onlineUsers = await db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarFileId: users.avatarFileId
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

	return json(onlineUsers, {
		headers: {
			'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
		}
	});
};
