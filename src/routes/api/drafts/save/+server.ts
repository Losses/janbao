import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import { drafts } from '$lib/server/db/schema';
import { DRAFT_CONTEXT_TYPES } from '$lib/server/constants';
import { MAX_CONTENT_SIZE } from '$lib/utils/lexical';
import type { RequestHandler } from './$types';

interface DraftSaveBody {
	contextType?: string;
	contextId?: number;
	contentJson?: string;
}

// POST /api/drafts/save - Atomic upsert draft record for the authenticated user.
// Uses Drizzle's onConflictDoUpdate targeting the unique composite index
// (authorId, contextType, contextId) to eliminate race conditions.
export const POST: RequestHandler = async ({ locals, request }) => {
	const t = locals.t;

	if (!locals.user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	let body: DraftSaveBody;
	try {
		body = (await request.json()) as DraftSaveBody;
	} catch {
		return jsonError(t, 'draft.invalidBody', 400);
	}

	const { contextType, contextId, contentJson } = body;

	if (!contextType || !contentJson) {
		return jsonError(t, 'draft.fieldsRequired', 400);
	}

	if (!DRAFT_CONTEXT_TYPES.includes(contextType as (typeof DRAFT_CONTEXT_TYPES)[number])) {
		return jsonError(t, 'draft.invalidContextType', 400);
	}

	if (contentJson.length > MAX_CONTENT_SIZE) {
		return jsonError(t, 'draft.contentTooLarge', 400);
	}

	const db = locals.db;
	const authorId = locals.user.id;
	const normalizedContextId = contextId ?? 0;
	const now = new Date();

	// Atomic upsert - on conflict over (authorId, contextType, contextId), update content
	await db
		.insert(drafts)
		.values({
			authorId,
			contextType,
			contextId: normalizedContextId,
			contentJson,
			updatedAt: now
		})
		.onConflictDoUpdate({
			target: [drafts.authorId, drafts.contextType, drafts.contextId],
			set: {
				contentJson,
				updatedAt: now
			}
		});

	return json({ success: true });
};
