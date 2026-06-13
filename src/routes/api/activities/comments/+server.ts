import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { activities } from '$lib/server/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { jsonError } from '$lib/server/errors';
import type { ActivityCommentCreateBody } from '$lib/types/api';
import { isLexicalEmpty, MAX_CONTENT_SIZE } from '$lib/utils/lexical';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const body: ActivityCommentCreateBody = await request.json();
	const parentActivityId = body.parentActivityId;
	const contentJson = body.contentJson;

	if (!parentActivityId) {
		return jsonError(t, 'activity.parentIdRequired', 400);
	}

	if (isLexicalEmpty(contentJson)) {
		return jsonError(t, 'common.contentRequired', 400);
	}

	if (contentJson.length > MAX_CONTENT_SIZE) {
		return jsonError(t, 'common.contentTooLarge', 400);
	}

	const parentRecords = await locals.db
		.select({ id: activities.id, parentActivityId: activities.parentActivityId })
		.from(activities)
		.where(and(eq(activities.id, parentActivityId), isNull(activities.deletedAt)))
		.limit(1);

	if (parentRecords.length === 0) {
		return jsonError(t, 'activity.parentNotFound', 404);
	}

	if (parentRecords[0].parentActivityId !== null) {
		return jsonError(t, 'activity.cannotNestComments', 400);
	}

	const commentId = crypto.randomUUID();

	await locals.db.insert(activities).values({
		id: commentId,
		authorId: user.id,
		recipientId: null,
		parentActivityId,
		contentJson,
		createdAt: new Date()
	});

	return json({ success: true, id: commentId }, { status: 201 });
};
