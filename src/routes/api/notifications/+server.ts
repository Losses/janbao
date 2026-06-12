import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import { notifications } from '$lib/server/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { getNotifications } from '$lib/server/db/dao/notifications';
import type { RequestHandler } from './$types';
import type { NotificationMarkReadBody } from '$lib/types/api';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
const MAX_MARK_READ_IDS = 500;

// GET /api/notifications - List the active user's notifications, newest first.
// Supports an optional `limit` query (capped at 100). The sidebar tooltip
// requests `limit=5`.
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

	const items = await getNotifications(locals.db, user.id, limit);
	return json({ notifications: items });
};

// PUT /api/notifications - Mark notifications as read.
// Accepts either a discrete list of `ids` or `{ all: true }` to mark every
// notification for the active user as read.
export const PUT: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	let body: NotificationMarkReadBody;
	try {
		body = (await request.json()) as NotificationMarkReadBody;
	} catch {
		return jsonError(t, 'common.badRequest', 400);
	}

	const db = locals.db;

	if (body.all) {
		await db
			.update(notifications)
			.set({ isRead: true })
			.where(and(eq(notifications.userId, user.id), eq(notifications.isRead, false)));
		return json({ success: true });
	}

	const ids = Array.isArray(body.ids)
		? body.ids.filter((id) => typeof id === 'string').slice(0, MAX_MARK_READ_IDS)
		: [];
	if (ids.length === 0) {
		return jsonError(t, 'common.badRequest', 400);
	}

	await db
		.update(notifications)
		.set({ isRead: true })
		.where(
			and(
				eq(notifications.userId, user.id),
				inArray(notifications.id, ids),
				eq(notifications.isRead, false)
			)
		);

	return json({ success: true });
};
