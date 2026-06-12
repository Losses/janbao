import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { activities } from '$lib/server/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import type { ActivityCommentCreateBody } from '$lib/types/api';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return json({ error: t.common.unauthorized }, { status: 401 });
	}

	const body: ActivityCommentCreateBody = await request.json();
	const parentActivityId = body.parentActivityId;
	const contentJson = body.contentJson;

	if (!parentActivityId) {
		return json({ error: t.activity.parentIdRequired }, { status: 400 });
	}

	if (!contentJson) {
		return json({ error: t.common.contentRequired }, { status: 400 });
	}

	if (contentJson.length > 512 * 1024) {
		return json({ error: t.common.contentTooLarge }, { status: 400 });
	}

	const parentRecords = await locals.db
		.select({ id: activities.id, parentActivityId: activities.parentActivityId })
		.from(activities)
		.where(and(eq(activities.id, parentActivityId), isNull(activities.deletedAt)))
		.limit(1);

	if (parentRecords.length === 0) {
		return json({ error: t.activity.parentNotFound }, { status: 404 });
	}

	if (parentRecords[0].parentActivityId !== null) {
		return json({ error: t.activity.cannotNestComments }, { status: 400 });
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
