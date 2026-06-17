import { json } from '@sveltejs/kit';
import { and, inArray } from 'drizzle-orm';
import { jsonError } from '$lib/server/errors';
import { discussions } from '$lib/server/db/schema';
import { getReadableCategorySlugs } from '$lib/server/constants';
import { applyReadStateDeltas } from '$lib/server/sync/read-state';
import type { SyncReadStateBody, SyncReadStateResponse } from '$lib/types/api';
import type { RequestHandler } from './$types';

const MAX_DELTAS = 200;

// PUT /api/sync/read-state - flush offline read-state deltas.
//
// INV-4: writes only `discussion_reads` (last-write-wins by lastReadAt). Never
// flips notifications.is_read - the offline read must not perform the read-page's
// notification reconciliation. The next online open of the discussion reconciles
// notifications from the read-state advanced here.
export const PUT: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	let body: SyncReadStateBody;
	try {
		body = (await request.json()) as SyncReadStateBody;
	} catch {
		return jsonError(t, 'common.badRequest', 400);
	}

	const deltas = Array.isArray(body?.deltas) ? body.deltas.slice(0, MAX_DELTAS) : [];
	const empty: SyncReadStateResponse = { applied: 0, skipped: 0, conflicts: [] };
	if (deltas.length === 0) return json(empty);

	const db = locals.db;
	const readableSlugs = await getReadableCategorySlugs(db, user.groupSlug);

	// Defense-in-depth: resolve which of the requested discussions sit in a category
	// the user can read; any delta outside that set is dropped before the upsert.
	const ids = deltas.map((d) => d.discussionId);
	const allowedRows =
		readableSlugs.length > 0
			? await db
					.select({ id: discussions.id })
					.from(discussions)
					.where(
						and(inArray(discussions.id, ids), inArray(discussions.categorySlug, readableSlugs))
					)
			: [];
	const allowedDiscussionIds = new Set(allowedRows.map((r) => r.id));

	const result = await applyReadStateDeltas({
		db,
		userId: user.id,
		deltas,
		allowedDiscussionIds
	});
	return json(result);
};
