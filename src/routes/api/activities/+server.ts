import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	activities,
	users,
	notificationPreferences,
	notifications,
	drafts
} from '$lib/server/db/schema';
import { eq, and, isNull, asc, inArray } from 'drizzle-orm';
import { jsonError } from '$lib/server/errors';
import type { DbTransaction } from '$lib/server/db';
import { indexActivity, unindexActivity } from '$lib/server/search/fts';
import type { ActivityCreateBody, ActivityDeleteBody } from '$lib/types/api';
import { isLexicalEmpty, MAX_CONTENT_SIZE } from '$lib/utils/lexical';

export const GET: RequestHandler = async ({ url, locals }) => {
	const t = locals.t;
	const parentId = Number(url.searchParams.get('parentId'));
	if (!parentId) {
		return jsonError(t, 'activity.parentIdRequired', 400);
	}

	const parentRecords = await locals.db
		.select({ id: activities.id })
		.from(activities)
		.where(and(eq(activities.id, parentId), isNull(activities.deletedAt)))
		.limit(1);

	if (parentRecords.length === 0) {
		return jsonError(t, 'activity.parentNotFound', 404);
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
		return jsonError(t, 'common.unauthorized', 401);
	}

	const body: ActivityCreateBody = await request.json();
	const contentJson = body.contentJson ?? '';
	const recipientId = body.recipientId;

	if (isLexicalEmpty(contentJson)) {
		return jsonError(t, 'common.contentRequired', 400);
	}

	if (contentJson.length > MAX_CONTENT_SIZE) {
		return jsonError(t, 'common.contentTooLarge', 400);
	}

	if (recipientId) {
		const recipient = await locals.db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.id, recipientId))
			.limit(1);

		if (recipient.length === 0) {
			return jsonError(t, 'activity.recipientNotFound', 404);
		}
	}

	const activityId = await locals.db.transaction(async (tx: DbTransaction) => {
		const inserted = await tx
			.insert(activities)
			.values({
				authorId: user.id,
				recipientId: recipientId || null,
				parentActivityId: null,
				contentJson,
				createdAt: new Date()
			})
			.returning({ id: activities.id });
		const id = inserted[0].id;
		await indexActivity(tx, id, contentJson);
		return id;
	});

	// Clear the composer draft so the editor starts fresh on next page load.
	// contextId = 0 marks the "new" (unsaved) activity composer draft; the
	// profile-page draft uses contextId = targetUser.id (user.id for owner,
	// recipientId for a guest viewing the recipient's profile).
	const draftContextIds: number[] = [0, user.id];
	if (recipientId && recipientId !== user.id) {
		draftContextIds.push(recipientId);
	}
	await locals.db
		.delete(drafts)
		.where(
			and(
				eq(drafts.authorId, user.id),
				eq(drafts.contextType, 'activity'),
				inArray(drafts.contextId, draftContextIds)
			)
		);

	if (recipientId && recipientId !== user.id) {
		const prefs = await locals.db
			.select({ profileComment: notificationPreferences.profileComment })
			.from(notificationPreferences)
			.where(eq(notificationPreferences.userId, recipientId))
			.limit(1);

		const shouldNotify = prefs.length === 0 ? true : prefs[0].profileComment;
		if (shouldNotify) {
			await locals.db.insert(notifications).values({
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
		return jsonError(t, 'common.unauthorized', 401);
	}

	const body: ActivityDeleteBody = await request.json();
	const activityId = body.activityId;

	if (!activityId) {
		return jsonError(t, 'activity.activityIdRequired', 400);
	}

	const activityRecords = await locals.db
		.select({
			id: activities.id,
			authorId: activities.authorId,
			recipientId: activities.recipientId,
			parentActivityId: activities.parentActivityId,
			contentJson: activities.contentJson
		})
		.from(activities)
		.where(and(eq(activities.id, activityId), isNull(activities.deletedAt)))
		.limit(1);

	if (activityRecords.length === 0) {
		return jsonError(t, 'activity.activityNotFound', 404);
	}

	const activity = activityRecords[0];
	const isAdmin = user.groupSlug === 'admin';

	let isAuthorized = activity.authorId === user.id || isAdmin;

	if (!isAuthorized && activity.recipientId) {
		isAuthorized = activity.recipientId === user.id;
	}

	if (!isAuthorized && activity.parentActivityId) {
		const parentActivity = await locals.db
			.select({ authorId: activities.authorId, recipientId: activities.recipientId })
			.from(activities)
			.where(and(eq(activities.id, activity.parentActivityId), isNull(activities.deletedAt)))
			.limit(1);

		if (parentActivity.length > 0) {
			if (parentActivity[0].authorId === user.id || parentActivity[0].recipientId === user.id) {
				isAuthorized = true;
			}
		}
	}

	if (!isAuthorized) {
		return jsonError(t, 'common.forbidden', 403);
	}

	await locals.db
		.update(activities)
		.set({ deletedAt: new Date() })
		.where(eq(activities.id, activityId));

	// contentJson is unchanged by the soft-delete; remove the indexed text so the
	// activity stops matching searches. (Search queries also filter deletedAt, so a
	// missed unindex here is harmless, but keeping the index tidy is cheaper.)
	await unindexActivity(locals.db, activityId, activity.contentJson);

	return json({ success: true });
};
