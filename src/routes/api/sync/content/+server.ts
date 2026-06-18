import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import { buildContentSync } from '$lib/server/sync/content';
import type { RequestHandler } from './$types';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// GET /api/sync/content - delta content sync for the offline reader.
//
// PURE READ (INV-4): buildContentSync and its DAO only SELECT from discussions /
// replies / bookmarks / categories - this handler must never write
// discussion_reads, notifications, or view counts. That separation is what lets
// the client pre-fetch discussions for offline reading without marking them read.
export const GET: RequestHandler = async ({ url, locals, platform }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const rawLimit = url.searchParams.get('limit');
	let limit = rawLimit ? parseInt(rawLimit, 10) : DEFAULT_LIMIT;
	if (isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
	if (limit > MAX_LIMIT) limit = MAX_LIMIT;

	const discussionsCursor = url.searchParams.get('discussionsCursor') ?? undefined;
	const repliesCursor = url.searchParams.get('repliesCursor') ?? undefined;
	const discussionTombstoneCursor = url.searchParams.get('discussionTombstoneCursor') ?? undefined;
	const replyTombstoneCursor = url.searchParams.get('replyTombstoneCursor') ?? undefined;

	const body = await buildContentSync({
		db: locals.db,
		groupSlug: user.groupSlug,
		userId: user.id,
		discussionsCursor,
		repliesCursor,
		discussionTombstoneCursor,
		replyTombstoneCursor,
		limit,
		platformEnv: platform?.env
	});
	return json(body);
};
