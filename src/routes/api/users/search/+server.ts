import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import { users } from '$lib/server/db/schema';
import { like, not, eq, and, sql } from 'drizzle-orm';
import { SYSTEM_USER_ID } from '$lib/server/constants';
import type { RequestHandler } from './$types';
import type { UserSearchResult } from '$lib/types/api';

const MAX_RESULTS = 10;
const MIN_QUERY_LENGTH = 1;

// GET /api/users/search?q=<term> — Username autocomplete for @mention chips,
// PM recipient selection, and the ParticipantAdder widget. Excludes the caller
// and the System User. Prefix-matches on username.
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const q = (url.searchParams.get('q') || '').trim();
	if (q.length < MIN_QUERY_LENGTH) {
		return json({ users: [] });
	}

	const db = locals.db;

	const results = await db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarFileId: users.avatarFileId
		})
		.from(users)
		.where(
			and(
				like(users.username, `${q}%`),
				not(eq(users.id, SYSTEM_USER_ID)),
				sql`${users.id} != ${user.id}`
			)
		)
		.limit(MAX_RESULTS);

	const mapped: UserSearchResult[] = results.map((r) => ({
		id: r.id,
		username: r.username,
		displayName: r.displayName,
		avatarFileId: r.avatarFileId
	}));

	return json({ users: mapped });
};
