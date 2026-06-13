import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import { drafts } from '$lib/server/db/schema';
import { DRAFT_CONTEXT_TYPES } from '$lib/server/constants';
import { eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import type { DraftClearBody } from '$lib/types/api';

// POST /api/drafts/clear - Delete a draft for the authenticated user by
// (contextType, contextId). Invoked from the client after a successful post /
// reply / message submission. Mirrors DELETE /api/drafts as a POST alternative
// per the spec, since fetch DELETE-with-body is not universally supported.
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	let body: DraftClearBody;
	try {
		body = (await request.json()) as DraftClearBody;
	} catch {
		return jsonError(t, 'draft.invalidBody', 400);
	}

	const contextType = body.contextType;
	const contextId = body.contextId ?? 0;

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
