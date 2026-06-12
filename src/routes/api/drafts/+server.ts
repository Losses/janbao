import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import { drafts } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';

const VALID_CONTEXT_TYPES = ['discussion', 'reply', 'message', 'activity'];

// DELETE /api/drafts?contextType=<type>&contextId=<id> — Delete a single draft
// for the authenticated user, keyed by its (contextType, contextId) composite.
export const DELETE: RequestHandler = async ({ url, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const contextType = url.searchParams.get('contextType');
	const contextId = url.searchParams.get('contextId') || '';

	if (!contextType) {
		return jsonError(t, 'draft.fieldsRequired', 400);
	}

	if (!VALID_CONTEXT_TYPES.includes(contextType)) {
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
