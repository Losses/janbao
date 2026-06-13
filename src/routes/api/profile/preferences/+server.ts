import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { notificationPreferences } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { jsonError } from '$lib/server/errors';
import type { ProfilePreferencesBody } from '$lib/types/api';

const VALID_PREF_KEYS = [
	'profileComment',
	'discussionReply',
	'discussionComment',
	'participatedComment',
	'mention',
	'bookmarkedDiscussionComment'
] as const;

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user) {
		return jsonError(t, 'common.unauthorized', 401);
	}

	const body: ProfilePreferencesBody = await request.json();
	const updates: Partial<ProfilePreferencesBody> = {};

	for (const key of VALID_PREF_KEYS) {
		const value = body[key];
		if (value !== undefined) {
			if (typeof value !== 'boolean') {
				return jsonError(t, 'profile.invalidValue', 400);
			}
			updates[key] = value;
		}
	}

	if (Object.keys(updates).length === 0) {
		return jsonError(t, 'common.noFieldsToUpdate', 400);
	}

	const existing = await locals.db
		.select({ userId: notificationPreferences.userId })
		.from(notificationPreferences)
		.where(eq(notificationPreferences.userId, user.id))
		.limit(1);

	if (existing.length === 0) {
		await locals.db.insert(notificationPreferences).values({
			userId: user.id,
			...updates
		});
	} else {
		await locals.db
			.update(notificationPreferences)
			.set(updates)
			.where(eq(notificationPreferences.userId, user.id));
	}

	return json({ success: true });
};
