import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import { getInvitations } from '$lib/server/db/dao/invitations';
import type { RequestHandler } from './$types';

// GET /api/invitations — List all invitation codes created by the active user,
// with each record's status resolved dynamically from usedById / expiresAt.
export const GET: RequestHandler = async ({ locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const items = await getInvitations(locals.db, user.id);
	return json({ invitations: items });
};
