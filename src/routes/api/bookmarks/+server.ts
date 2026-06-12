import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { bookmarks, discussions } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
	}

	const { discussionId } = (await event.request.json()) as { discussionId: string };
	if (!discussionId) {
		return new Response(JSON.stringify({ error: 'Missing discussionId' }), { status: 400 });
	}

	const db = event.locals.db;

	// Check if discussion exists
	const discussionExists = await db
		.select()
		.from(discussions)
		.where(eq(discussions.id, discussionId))
		.limit(1);

	if (discussionExists.length === 0) {
		return new Response(JSON.stringify({ error: 'Discussion not found' }), { status: 404 });
	}

	try {
		await db
			.insert(bookmarks)
			.values({
				userId: user.id,
				discussionId,
				bookmarkedAt: new Date()
			})
			.onConflictDoNothing();

		return json({ success: true, bookmarked: true });
	} catch {
		return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
	}

	const discussionId = event.url.searchParams.get('discussionId');
	if (!discussionId) {
		return new Response(JSON.stringify({ error: 'Missing discussionId' }), { status: 400 });
	}

	const db = event.locals.db;

	try {
		await db
			.delete(bookmarks)
			.where(and(eq(bookmarks.userId, user.id), eq(bookmarks.discussionId, discussionId)));

		return json({ success: true, bookmarked: false });
	} catch {
		return new Response(JSON.stringify({ error: 'Database error' }), { status: 500 });
	}
};
