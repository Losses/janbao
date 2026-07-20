import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import { drafts } from '$lib/server/db/schema';
import { DRAFT_CONTEXT_TYPES } from '$lib/server/constants';
import { normalizeDraftContextId } from '$lib/server/utils/drafts';
import { eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// DELETE /api/drafts?contextType=<type>&contextId=<id> - Delete a single draft
// for the authenticated user, keyed by its (contextType, contextId) composite.
export const DELETE: RequestHandler = async ({ url, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const contextType = url.searchParams.get('contextType');
	// Parse the query string to a number first (searchParams.get yields
	// `string | null`, which the shared helper would otherwise coerce to 0 for
	// every input), then hand the result to normalizeDraftContextId so this
	// DELETE path matches the save/clear boundary: a missing, non-numeric, or
	// non-finite contextId collapses to 0 (the "new composer" draft key)
	// instead of diverging from the integer-keyed save/clear queries. See
	// $lib/server/utils/drafts.ts for the rationale.
	const contextId = normalizeDraftContextId(Number(url.searchParams.get('contextId')));

	if (!contextType) {
		return jsonError(t, 'draft.contextFieldsRequired', 400);
	}

	if (!DRAFT_CONTEXT_TYPES.includes(contextType as (typeof DRAFT_CONTEXT_TYPES)[number])) {
		return jsonError(t, 'draft.invalidContextType', 400);
	}

	await locals.db
		.delete(drafts)
		.where(
			and(
				eq(drafts.authorId, user.id),
				eq(drafts.contextType, contextType),
				eq(drafts.contextId, contextId)
			)
		);

	return json({ success: true });
};
