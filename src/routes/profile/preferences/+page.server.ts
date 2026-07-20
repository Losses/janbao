import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { notificationPreferences } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getVapidPublicKeyBase64Url } from '$lib/server/push/keys';
import { buildSignInRedirectUrl } from '$lib/utils/redirect';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const user = locals.user;
	if (!user) {
		redirect(302, buildSignInRedirectUrl('/profile/preferences'));
	}

	const db = locals.db;

	// Fetch notification preferences (in-app + push columns).
	const prefsRecords = await db
		.select()
		.from(notificationPreferences)
		.where(eq(notificationPreferences.userId, user.id))
		.limit(1);

	const prefs =
		prefsRecords.length > 0
			? prefsRecords[0]
			: {
					profileComment: true,
					discussionReply: true,
					discussionComment: true,
					participatedComment: true,
					mention: true,
					bookmarkedDiscussionComment: true,
					pushProfileComment: true,
					pushDiscussionReply: true,
					pushDiscussionComment: true,
					pushParticipatedComment: true,
					pushMention: true,
					pushBookmarkedDiscussionComment: true,
					pushMessage: true
				};

	return {
		preferences: prefs,
		// VAPID public key for the browser PushManager; null when push is not
		// configured (the UI then hides the push section).
		vapidPublicKey: getVapidPublicKeyBase64Url(platform?.env)
	};
};
