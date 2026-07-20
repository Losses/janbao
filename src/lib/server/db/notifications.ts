/**
 * Notification Dispatcher (RQ00-Backend §5.4).
 *
 * Centralizes all notification side-effects triggered by content creation.
 * Each entry-point resolves the relevant recipient set, batch-fetches their
 * notification preferences, and inserts one notification per eligible user.
 *
 * Per-category preference mapping:
 *  - mention            -> pref.mention
 *  - discussion owner   -> pref.discussionReply || pref.discussionComment
 *  - thread participant -> pref.participatedComment
 *  - bookmark subscriber-> pref.bookmarkedDiscussionComment
 *
 * A user receives at most one notification per content-creation event: when a
 * user qualifies under several categories, the most specific category wins
 * (mention > owner > participant > bookmarker).
 */
import {
	users,
	notifications,
	notificationPreferences,
	discussions,
	replies,
	bookmarks
} from './schema';
import { eq, and, isNull, ne, inArray } from 'drizzle-orm';
import type { D1Db } from './index';
import { extractMentions } from '$lib/utils/mentions';
import { isRealUserId } from '$lib/utils/user';

export type ReplyNotifCategory = 'mention' | 'owner' | 'participant' | 'bookmarker';

interface ReplyNotificationContext {
	discussionId: number;
	replyId: number;
	authorId: number;
	contentJson: string;
}

export interface NewNotificationRow {
	userId: number;
	type: string;
	category: ReplyNotifCategory;
	sourceUserId: number;
	discussionId: number;
	replyId: number;
	createdAt: Date;
}

/**
 * Dispatch notifications triggered by a new discussion reply.
 *
 * Returns the rows that were inserted (or would have been inserted if the
 * batch were non-empty), so callers can fan out a parallel best-effort push
 * pass without re-resolving the recipient set.
 */
export async function dispatchReplyNotifications(
	db: D1Db,
	ctx: ReplyNotificationContext
): Promise<NewNotificationRow[]> {
	// 1. Resolve the discussion owner (skip if the discussion is soft-deleted)
	const discussionRecords = await db
		.select({ authorId: discussions.authorId })
		.from(discussions)
		.where(and(eq(discussions.id, ctx.discussionId), isNull(discussions.deletedAt)))
		.limit(1);

	if (discussionRecords.length === 0) {
		return [];
	}

	const ownerId = discussionRecords[0].authorId;

	// 2. Resolve mentioned user IDs from the reply content.
	// Sentinel accounts (System -1, Ghost -2) are dropped via isRealUserId: they
	// never receive notifications even when an author literally types @system,
	// because they are not real participants and a notification row for them is
	// semantically meaningless. Stealth users DO still receive @mention
	// notifications: stealth is a presence-surfacing opt-out (Active Users Wall,
	// last-active), not a social-interaction opt-out, and a literal @username is
	// the author's explicit intent to direct attention to that account.
	const mentionUsernames = extractMentions(ctx.contentJson);
	const mentionIds: number[] = [];
	if (mentionUsernames.length > 0) {
		const mentionedUsers = await db
			.select({ id: users.id })
			.from(users)
			.where(inArray(users.username, mentionUsernames));
		for (const m of mentionedUsers) {
			if (isRealUserId(m.id) && m.id !== ctx.authorId) {
				mentionIds.push(m.id);
			}
		}
	}

	// 3. Resolve other thread participants (distinct prior reply authors)
	const participantRows = await db
		.select({ authorId: replies.authorId })
		.from(replies)
		.where(
			and(
				eq(replies.discussionId, ctx.discussionId),
				isNull(replies.deletedAt),
				ne(replies.authorId, ctx.authorId)
			)
		);
	const participantIds = [...new Set(participantRows.map((r) => r.authorId))];

	// 4. Resolve bookmark subscribers
	const bookmarkerRows = await db
		.select({ userId: bookmarks.userId })
		.from(bookmarks)
		.where(eq(bookmarks.discussionId, ctx.discussionId));
	const bookmarkerIds = [
		...new Set(bookmarkerRows.map((b) => b.userId).filter((id) => id !== ctx.authorId))
	];

	// 5. Build candidate map with category priority (first-write wins)
	const candidates = new Map<number, ReplyNotifCategory>();
	for (const id of mentionIds) {
		if (!candidates.has(id)) candidates.set(id, 'mention');
	}
	if (ownerId !== ctx.authorId && !candidates.has(ownerId)) {
		candidates.set(ownerId, 'owner');
	}
	for (const id of participantIds) {
		if (!candidates.has(id)) candidates.set(id, 'participant');
	}
	for (const id of bookmarkerIds) {
		if (!candidates.has(id)) candidates.set(id, 'bookmarker');
	}

	if (candidates.size === 0) {
		return [];
	}

	// 6. Batch-fetch preferences for all candidates
	const candidateIds = [...candidates.keys()];
	const prefs = await db
		.select()
		.from(notificationPreferences)
		.where(inArray(notificationPreferences.userId, candidateIds));
	const prefMap = new Map(prefs.map((p) => [p.userId, p]));

	// 7. Insert one notification per eligible candidate
	const now = new Date();
	const rows: NewNotificationRow[] = [];
	for (const [userId, category] of candidates) {
		const pref = prefMap.get(userId);
		const eligible = isEligible(category, pref);
		if (!eligible) continue;

		rows.push({
			userId,
			type: notificationTypeFor(category),
			category,
			sourceUserId: ctx.authorId,
			discussionId: ctx.discussionId,
			replyId: ctx.replyId,
			createdAt: now
		});
	}

	if (rows.length > 0) {
		// `category` is a runtime-only hint for push delivery; it is not a DB column.
		const insertRows = rows.map((row) => ({
			userId: row.userId,
			type: row.type,
			sourceUserId: row.sourceUserId,
			discussionId: row.discussionId,
			replyId: row.replyId,
			createdAt: row.createdAt
		}));
		await db.insert(notifications).values(insertRows);
	}
	return rows;
}

interface NotificationPreferenceFields {
	mention: boolean;
	discussionReply: boolean;
	discussionComment: boolean;
	participatedComment: boolean;
	bookmarkedDiscussionComment: boolean;
}

function isEligible(
	category: ReplyNotifCategory,
	pref: NotificationPreferenceFields | undefined
): boolean {
	// No preference row means default-true for every category.
	if (!pref) return true;
	switch (category) {
		case 'mention':
			return pref.mention;
		case 'owner':
			return pref.discussionReply || pref.discussionComment;
		case 'participant':
			return pref.participatedComment;
		case 'bookmarker':
			return pref.bookmarkedDiscussionComment;
	}
}

function notificationTypeFor(category: ReplyNotifCategory): string {
	if (category === 'mention') return 'mention';
	if (category === 'owner') return 'reply';
	if (category === 'participant') return 'participated_comment';
	if (category === 'bookmarker') return 'bookmarked_comment';
	return 'discussion_comment';
}
