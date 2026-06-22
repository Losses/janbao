import { drafts, users } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import type { D1Db } from '$lib/server/db';
import type { UserSearchResult } from '$lib/types/api';

export interface MessageComposePrefill {
	messageDraft: string | null;
	prefillRecipient: UserSearchResult | null;
}

/**
 * Shared loader for the message-compose routes. Both `/messages/new`
 * (recipient via `?recipient=`) and `/messages/add/[userId]` (recipient via
 * the route param) resolve the author's saved draft plus an optional prefilled
 * recipient, so the compose UI and its load logic are not duplicated.
 *
 * A null/unknown/self recipient yields no prefill rather than erroring, so
 * stale or malformed links still land on a usable compose form.
 */
export async function resolveMessageComposePrefill(
	db: D1Db,
	userId: number,
	recipientId: number | null
): Promise<MessageComposePrefill> {
	let messageDraft: string | null = null;
	const draftRows = await db
		.select({ contentJson: drafts.contentJson })
		.from(drafts)
		.where(
			and(eq(drafts.authorId, userId), eq(drafts.contextType, 'message'), eq(drafts.contextId, 0))
		)
		.limit(1);
	if (draftRows.length > 0) {
		messageDraft = draftRows[0].contentJson;
	}

	let prefillRecipient: UserSearchResult | null = null;
	if (recipientId && recipientId !== userId) {
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
}
