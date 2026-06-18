import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import { buildContentSync } from '$lib/server/sync/content';
import { getCachedUsers } from '$lib/server/db/dao/sync';
import type { RequestHandler } from './$types';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const MAX_BACKFILL_IDS = 500;

// GET /api/sync/content - delta content sync for the offline reader.
//
// PURE READ (INV-4): buildContentSync and its DAO only SELECT from discussions /
// replies / bookmarks / categories - this handler must never write
// discussion_reads, notifications, or view counts. That separation is what lets
// the client pre-fetch discussions for offline reading without marking them read.
//
// With ?backfillUserIds=1,2,3 this endpoint returns ONLY user display info for the
// given ids (a lightweight backfill path so the offline reader can populate author
// avatars/names for content cached before the users store existed).
export const GET: RequestHandler = async ({ url, locals, platform }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const backfillRaw = url.searchParams.get('backfillUserIds');
	if (backfillRaw) {
		const userIds = backfillRaw
			.split(',')
			.map(Number)
			.filter((n) => Number.isFinite(n) && n > 0)
			.slice(0, MAX_BACKFILL_IDS);
		const users = await getCachedUsers(locals.db, userIds);
		return json({ users });
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
