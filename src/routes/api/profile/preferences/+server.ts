import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { notificationPreferences } from '$lib/server/db/schema';
import { jsonError } from '$lib/server/errors';
import type { ProfilePreferencesBody } from '$lib/types/api';

const VALID_PREF_KEYS = [
	'profileComment',
	'discussionReply',
	'discussionComment',
	'participatedComment',
	'mention',
	'bookmarkedDiscussionComment',
	'pushProfileComment',
	'pushDiscussionReply',
	'pushDiscussionComment',
	'pushParticipatedComment',
	'pushMention',
	'pushBookmarkedDiscussionComment',
	'pushMessage'
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

	// Atomic upsert: ON CONFLICT DO UPDATE on the userId primary key folds
	// `updates` onto an existing row, or inserts when none exists. The single
	// statement is race-safe against double-clicks and retry storms from the
	// same user.
	await locals.db
		.insert(notificationPreferences)
		.values({
			userId: user.id,
			...updates
		})
		.onConflictDoUpdate({
			target: notificationPreferences.userId,
			set: updates
		});

	return json({ success: true });
};
