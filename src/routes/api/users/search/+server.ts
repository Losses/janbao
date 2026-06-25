import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import { users } from '$lib/server/db/schema';
import { like, not, eq, and, ne, or, desc } from 'drizzle-orm';
import { SYSTEM_USER_ID } from '$lib/server/constants';
import { buildAvatarUrl } from '$lib/utils/image';
import type { RequestHandler } from './$types';
import type { UserSearchResult } from '$lib/types/api';

const MAX_RESULTS = 10;

// GET /api/users/search?q=<term>&limit=<n> - Username/displayName autocomplete
// for @mention typeahead chips, PM recipient selection, and the ParticipantAdder
// widget. Excludes the caller and the System User. With a term, prefix-matches on
// both username and displayName. With an empty term (bare @), returns the most
// recently active users as a starting suggestion set.
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const q = (url.searchParams.get('q') || '').trim();

	const limitParam = parseInt(url.searchParams.get('limit') || String(MAX_RESULTS));
	const limit = Math.min(Math.max(limitParam, 1), MAX_RESULTS);

	const db = locals.db;

	// Excludes the caller, the System User, and stealth users (who opted out of
	// presence surfacing) in both branches.
	const baseConditions = and(
		not(eq(users.id, SYSTEM_USER_ID)),
		ne(users.id, user.id),
		eq(users.isStealth, false)
	);

	const query = db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarFileId: users.avatarFileId,
			avatarContentType: users.avatarContentType
		})
		.from(users)
		.where(
			q.length === 0
				? baseConditions
				: and(baseConditions, or(like(users.username, `${q}%`), like(users.displayName, `${q}%`)))
		);

	if (q.length === 0) {
		query.orderBy(desc(users.lastActiveTime));
	}
	query.limit(limit);

	const results = await query;

	const mapped: UserSearchResult[] = results.map((r) => ({
		id: r.id,
		username: r.username,
		displayName: r.displayName,
		avatarUrl: buildAvatarUrl(r.id, r.avatarFileId, r.avatarContentType)
	}));

	return json({ users: mapped });
};
