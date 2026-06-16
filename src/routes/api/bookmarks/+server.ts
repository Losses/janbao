import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import type { RequestHandler } from './$types';
import { bookmarks, discussions, categories } from '$lib/server/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { getBookmarks } from '$lib/server/db/dao/bookmarks';
import {
	getReadableCategorySlugs,
	resolveGroupSlug,
	resolvePermissions
} from '$lib/server/constants';
import type { BookmarkToggleBody } from '$lib/types/api';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// GET /api/bookmarks - List discussions bookmarked by the active user, newest
// bookmark first. Supports `page` and `limit` (tooltip widget uses limit=5).
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const rawLimit = url.searchParams.get('limit');
	let limit = rawLimit ? parseInt(rawLimit, 10) : DEFAULT_LIMIT;
	if (isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
	if (limit > MAX_LIMIT) limit = MAX_LIMIT;

	const rawPage = url.searchParams.get('page');
	let page = rawPage ? parseInt(rawPage, 10) : 1;
	if (isNaN(page) || page < 1) page = 1;
	const offset = (page - 1) * limit;

	// Apply the same readable-category filter the /bookmarks page loader uses, so
	// the tooltip widget (and direct API calls) do not surface bookmarks in
	// categories the caller's group can no longer read.
	const readableSlugs = await getReadableCategorySlugs(locals.db, resolveGroupSlug(user));
	const filters = {
		readableCategorySlugs: readableSlugs.length > 0 ? readableSlugs : ['__none__']
	};

	const items = await getBookmarks(locals.db, user.id, { limit, offset }, filters);
	return json({ bookmarks: items, page, limit });
};

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	const t = event.locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const { discussionId } = (await event.request.json()) as BookmarkToggleBody;
	if (!discussionId) {
		return jsonError(t, 'bookmark.discussionRequired', 400);
	}

	const db = event.locals.db;

	// Check if discussion exists and is not soft-deleted or in a disabled category
	const discussionExists = await db
		.select({ categorySlug: discussions.categorySlug })
		.from(discussions)
		.innerJoin(categories, eq(discussions.categorySlug, categories.slug))
		.where(
			and(
				eq(discussions.id, discussionId),
				isNull(discussions.deletedAt),
				isNull(categories.disabledAt)
			)
		)
		.limit(1);

	if (discussionExists.length === 0) {
		return jsonError(t, 'bookmark.notFound', 404);
	}

	const perms = await resolvePermissions(db, discussionExists[0].categorySlug, user);
	if (!perms.canRead) {
		return jsonError(t, 'common.forbidden', 403);
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

	const discussionId = Number(event.url.searchParams.get('discussionId'));
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
