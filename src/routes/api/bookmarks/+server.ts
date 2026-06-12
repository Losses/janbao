import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import type { RequestHandler } from './$types';
import { bookmarks, discussions } from '$lib/server/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	const t = event.locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const { discussionId } = (await event.request.json()) as { discussionId: string };
	if (!discussionId) {
		return jsonError(t, 'bookmark.discussionRequired', 400);
	}

	const db = event.locals.db;

	// Check if discussion exists and is not soft-deleted
	const discussionExists = await db
		.select()
		.from(discussions)
		.where(and(eq(discussions.id, discussionId), isNull(discussions.deletedAt)))
		.limit(1);

	if (discussionExists.length === 0) {
		return jsonError(t, 'bookmark.notFound', 404);
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
		return jsonError(t, 'bookmark.dbError', 500);
	}
};

export const DELETE: RequestHandler = async (event) => {
	const user = event.locals.user;
	const t = event.locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const discussionId = event.url.searchParams.get('discussionId');
	if (!discussionId) {
		return jsonError(t, 'bookmark.discussionRequired', 400);
	}

	const db = event.locals.db;

	try {
		await db
			.delete(bookmarks)
			.where(and(eq(bookmarks.userId, user.id), eq(bookmarks.discussionId, discussionId)));

		return json({ success: true, bookmarked: false });
	} catch {
		return jsonError(t, 'bookmark.dbError', 500);
	}
};
