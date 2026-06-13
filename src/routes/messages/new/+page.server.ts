import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { drafts, users } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import type { UserSearchResult } from '$lib/types/api';

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) {
		redirect(302, '/entry/signin');
	}

	const db = event.locals.db;

	let messageDraft: string | null = null;
	const draftRows = await db
		.select({ contentJson: drafts.contentJson })
		.from(drafts)
		.where(
			and(eq(drafts.authorId, user.id), eq(drafts.contextType, 'message'), eq(drafts.contextId, 0))
		)
		.limit(1);
	if (draftRows.length > 0) {
		messageDraft = draftRows[0].contentJson;
	}

	// Optional ?recipient=<userId> prefill (from the Active Users Wall)
	const recipientId = Number(event.url.searchParams.get('recipient'));
	let prefillRecipient: UserSearchResult | null = null;
	if (recipientId && recipientId !== user.id) {
		const recipientRows = await db
			.select({
				id: users.id,
				username: users.username,
				displayName: users.displayName,
				avatarFileId: users.avatarFileId
			})
			.from(users)
			.where(eq(users.id, recipientId))
			.limit(1);
		if (recipientRows.length > 0) {
			prefillRecipient = recipientRows[0];
		}
	}

	return { messageDraft, prefillRecipient };
};
