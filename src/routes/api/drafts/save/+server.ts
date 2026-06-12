import { json } from '@sveltejs/kit';
import { drafts } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

interface DraftSaveBody {
	contextType?: string;
	contextId?: string;
	contentJson?: string;
}

const VALID_CONTEXT_TYPES = ['discussion', 'reply', 'message', 'activity'];
const MAX_CONTENT_SIZE = 512 * 1024; // 512 KiB limit for draft content

// POST /api/drafts/save — Atomic upsert draft record for the authenticated user.
// Uses Drizzle's onConflictDoUpdate targeting the unique composite index
// (authorId, contextType, contextId) to eliminate race conditions.
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: DraftSaveBody;
	try {
		body = (await request.json()) as DraftSaveBody;
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const { contextType, contextId, contentJson } = body;

	if (!contextType || !contentJson) {
		return json({ error: 'contextType and contentJson are required' }, { status: 400 });
	}

	if (!VALID_CONTEXT_TYPES.includes(contextType)) {
		return json({ error: 'Invalid contextType' }, { status: 400 });
	}

	if (contentJson.length > MAX_CONTENT_SIZE) {
		return json({ error: 'Draft content exceeds maximum allowed size' }, { status: 400 });
	}

	const db = locals.db;
	const authorId = locals.user.id;
	const normalizedContextId = contextId ?? '';
	const now = new Date();

	// Atomic upsert — on conflict over (authorId, contextType, contextId), update content
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
