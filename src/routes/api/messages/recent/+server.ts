import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import { getConversations } from '$lib/server/db/dao/messages';
import type { RequestHandler } from './$types';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

// GET /api/messages/recent — The active user's most recently active
// conversations, each with a last-message preview and unread count. Used by
// the Messages sidebar tooltip (limit=5).
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const rawLimit = url.searchParams.get('limit');
	let limit = rawLimit ? parseInt(rawLimit, 10) : DEFAULT_LIMIT;
	if (isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
	if (limit > MAX_LIMIT) limit = MAX_LIMIT;

	const { items } = await getConversations(locals.db, user.id, { limit, offset: 0 });
	return json({ conversations: items });
};
