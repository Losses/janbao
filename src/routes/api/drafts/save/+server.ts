import { json } from '@sveltejs/kit';
import { drafts } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';

interface DraftSaveBody {
	contextType?: string;
	contextId?: string;
	contentJson?: string;
}

// POST /api/drafts/save — Upsert draft record for the authenticated user.
// Uses the unique composite index (authorId, contextType, contextId) as conflict target.
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

	const db = locals.db;
	const authorId = locals.user.id;

	// Attempt to find an existing draft for this author + context combination
	const existing = await db
		.select({ id: drafts.id })
		.from(drafts)
		.where(
			and(
				eq(drafts.authorId, authorId),
				eq(drafts.contextType, contextType),
				contextId ? eq(drafts.contextId, contextId) : eq(drafts.contextId, '')
			)
		)
		.limit(1);

	const now = new Date();

	if (existing.length > 0) {
		// Update existing draft
		await db
			.update(drafts)
			.set({
				contentJson,
				updatedAt: now
			})
			.where(eq(drafts.id, existing[0].id));
	} else {
		// Insert new draft
		await db.insert(drafts).values({
			authorId,
			contextType,
			contextId: contextId ?? '',
			contentJson,
			updatedAt: now
		});
	}

	return json({ success: true });
};
