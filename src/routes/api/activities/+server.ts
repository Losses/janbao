import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { activities, users, notificationPreferences, notifications } from '$lib/server/db/schema';
import { eq, and, isNull, asc } from 'drizzle-orm';
import type { ActivityCreateBody, ActivityDeleteBody } from '$lib/types/api';

export const GET: RequestHandler = async ({ url, locals }) => {
	const t = locals.t;
	const parentId = url.searchParams.get('parentId');
	if (!parentId) {
		return json({ error: t.activity.parentIdRequired }, { status: 400 });
	}

	const parentRecords = await locals.db
		.select({ id: activities.id })
		.from(activities)
		.where(and(eq(activities.id, parentId), isNull(activities.deletedAt)))
		.limit(1);

	if (parentRecords.length === 0) {
		return json({ error: t.activity.parentNotFound }, { status: 404 });
	}

	const comments = await locals.db
		.select({
			id: activities.id,
			authorId: activities.authorId,
			contentJson: activities.contentJson,
			createdAt: activities.createdAt,
			authorDisplayName: users.displayName,
			authorUsername: users.username,
			authorAvatarFileId: users.avatarFileId
		})
		.from(activities)
		.innerJoin(users, eq(activities.authorId, users.id))
		.where(and(eq(activities.parentActivityId, parentId), isNull(activities.deletedAt)))
		.orderBy(asc(activities.createdAt));

	return json({ comments });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return json({ error: t.common.unauthorized }, { status: 401 });
	}

	const body: ActivityCreateBody = await request.json();
	const contentJson = body.contentJson;
	const recipientId = body.recipientId;

	if (!contentJson) {
		return json({ error: t.common.contentRequired }, { status: 400 });
	}

	if (contentJson.length > 512 * 1024) {
		return json({ error: t.common.contentTooLarge }, { status: 400 });
	}

	if (recipientId) {
		const recipient = await locals.db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.id, recipientId))
			.limit(1);

		if (recipient.length === 0) {
			return json({ error: t.activity.recipientNotFound }, { status: 404 });
		}
	}

	const activityId = crypto.randomUUID();

	await locals.db.insert(activities).values({
		id: activityId,
		authorId: user.id,
		recipientId: recipientId || null,
		parentActivityId: null,
		contentJson,
		createdAt: new Date()
	});

	if (recipientId && recipientId !== user.id) {
		const prefs = await locals.db
			.select({ profileComment: notificationPreferences.profileComment })
			.from(notificationPreferences)
			.where(eq(notificationPreferences.userId, recipientId))
			.limit(1);

		const shouldNotify = prefs.length === 0 ? true : prefs[0].profileComment;
		if (shouldNotify) {
			await locals.db.insert(notifications).values({
				id: crypto.randomUUID(),
				userId: recipientId,
				type: 'profile_comment',
				sourceUserId: user.id,
				activityId,
				createdAt: new Date()
			});
		}
	}

	return json({ success: true, id: activityId }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return json({ error: t.common.unauthorized }, { status: 401 });
	}

	const body: ActivityDeleteBody = await request.json();
	const activityId = body.activityId;

	if (!activityId) {
		return json({ error: t.activity.activityIdRequired }, { status: 400 });
	}

	const activityRecords = await locals.db
		.select({
			id: activities.id,
			authorId: activities.authorId,
			recipientId: activities.recipientId,
			parentActivityId: activities.parentActivityId
		})
		.from(activities)
		.where(and(eq(activities.id, activityId), isNull(activities.deletedAt)))
		.limit(1);

	if (activityRecords.length === 0) {
		return json({ error: t.activity.activityNotFound }, { status: 404 });
	}

	const activity = activityRecords[0];
	const isAdmin = user.groupSlug === 'admin';

	let isAuthorized = activity.authorId === user.id || isAdmin;

	if (!isAuthorized && activity.recipientId) {
		isAuthorized = activity.recipientId === user.id;
	}

	if (!isAuthorized && activity.parentActivityId) {
		const parentActivity = await locals.db
			.select({ authorId: activities.authorId })
			.from(activities)
			.where(eq(activities.id, activity.parentActivityId))
			.limit(1);

		if (parentActivity.length > 0 && parentActivity[0].authorId === user.id) {
			isAuthorized = true;
		}
	}

	if (!isAuthorized) {
		return json({ error: t.common.forbidden }, { status: 403 });
	}

	await locals.db
		.update(activities)
		.set({ deletedAt: new Date() })
		.where(eq(activities.id, activityId));

	return json({ success: true });
};
