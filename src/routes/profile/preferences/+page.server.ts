import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { notificationPreferences } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) {
		redirect(302, '/entry/signin?redirectTo=/profile/preferences');
	}

	const db = locals.db;

	// Fetch notification preferences
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
					privateMessage: true,
					discussionComment: true,
					participatedComment: true,
					mention: true,
					bookmarkedDiscussionComment: true
				};

	return { preferences: prefs };
};
