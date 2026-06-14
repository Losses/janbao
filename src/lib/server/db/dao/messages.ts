import {
	conversations,
	conversationParticipants,
	messages,
	users,
	conversationReads
} from '../schema';
import { eq, and, isNull, inArray, ne, sql } from 'drizzle-orm';
import type { D1Db } from '../index';
import type { ConversationListItem, ListOffsetOptions } from '$lib/types/api';
import { extractPlainText } from '$lib/utils/mentions';

interface ConversationListResult {
	items: ConversationListItem[];
	total: number;
}

/**
 * List the active user's conversations, sorted by most recent message and
 * paginated. Each item carries a last-message preview and unread count.
 *
 * Performance: conversation ids are resolved and sorted first (lightweight
 * MAX query), then only the current page's conversations are expanded with
 * title / participant-count / latest-message / unread details.
 */
export async function getConversations(
	db: D1Db,
	userId: number,
	options: ListOffsetOptions
): Promise<ConversationListResult> {
	// 1. All conversation ids the user participates in (excluding soft-deleted)
	const participantRows = await db
		.select({ conversationId: conversationParticipants.conversationId })
		.from(conversationParticipants)
		.innerJoin(conversations, eq(conversationParticipants.conversationId, conversations.id))
		.where(and(eq(conversationParticipants.userId, userId), isNull(conversations.deletedAt)));

	const allIds = [...new Set(participantRows.map((p) => p.conversationId))];
	if (allIds.length === 0) {
		return { items: [], total: 0 };
	}

	// 2. Last-message time per conversation → sort + paginate
	const lastTimeRows = await db
		.select({
			conversationId: messages.conversationId,
			// MAX() over an integer column returns the raw stored epoch value
			// (number), not a Date  - the sql<number> reflects the runtime type,
			// since Drizzle's timestamp mapper does not apply to raw aggregates.
			maxAt: sql<number>`MAX(${messages.createdAt})`
		})
		.from(messages)
		.where(inArray(messages.conversationId, allIds))
		.groupBy(messages.conversationId);
	const lastTimeMap = new Map(lastTimeRows.map((r) => [r.conversationId, r.maxAt]));

	const sortedIds = allIds.sort((a, b) => {
		const aTime = lastTimeMap.get(a) ?? 0;
		const bTime = lastTimeMap.get(b) ?? 0;
		return bTime - aTime;
	});

	const total = sortedIds.length;
	const pageIds = sortedIds.slice(options.offset, options.offset + options.limit);
	if (pageIds.length === 0) {
		return { items: [], total };
	}

	// 3. Titles
	const convMeta = await db
		.select({ id: conversations.id, title: conversations.title })
		.from(conversations)
		.where(and(inArray(conversations.id, pageIds), isNull(conversations.deletedAt)));
	const titleMap = new Map(convMeta.map((c) => [c.id, c.title]));

	// 4. Participant counts
	const countRows = await db
		.select({
			conversationId: conversationParticipants.conversationId,
			count: sql<number>`COUNT(*)`
		})
		.from(conversationParticipants)
		.where(inArray(conversationParticipants.conversationId, pageIds))
		.groupBy(conversationParticipants.conversationId);
	const countMap = new Map(countRows.map((p) => [p.conversationId, p.count]));

	// 4b. Message counts (total messages per conversation) for the list meta line.
	const messageCountRows = await db
		.select({
			conversationId: messages.conversationId,
			count: sql<number>`COUNT(*)`
		})
		.from(messages)
		.where(inArray(messages.conversationId, pageIds))
		.groupBy(messages.conversationId);
	const messageCountMap = new Map(messageCountRows.map((m) => [m.conversationId, m.count]));

	// 5. Latest message detail (preview) per page conversation
	const latestSubq = db
		.select({
			conversationId: messages.conversationId,
			maxAt: sql<Date>`MAX(${messages.createdAt})`.as('max_at')
		})
		.from(messages)
		.where(inArray(messages.conversationId, pageIds))
		.groupBy(messages.conversationId)
		.as('latest_msg');

	const latestDetails = await db
		.select({
			conversationId: latestSubq.conversationId,
			maxAt: latestSubq.maxAt,
			id: messages.id,
			contentJson: messages.contentJson,
			createdAt: messages.createdAt
		})
		.from(latestSubq)
		.innerJoin(
			messages,
			and(
				eq(messages.conversationId, latestSubq.conversationId),
				eq(messages.createdAt, latestSubq.maxAt)
			)
		);
	// Tie-break on timestamp ties: keep the row with the largest message id per
	// conversation so the "latest" preview is deterministic.
	const latestMap = new Map<number, (typeof latestDetails)[number]>();
	for (const row of latestDetails) {
		const existing = latestMap.get(row.conversationId);
		if (!existing || row.id > existing.id) {
			latestMap.set(row.conversationId, row);
		}
	}

	// 5b. Participants details per page conversation to identify the display user
	// (the first participant who is not the active user, or the active user if self-chat)
	const participants = await db
		.select({
			conversationId: conversationParticipants.conversationId,
			userId: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarFileId: users.avatarFileId,
			joinedAt: conversationParticipants.joinedAt
		})
		.from(conversationParticipants)
		.innerJoin(users, eq(conversationParticipants.userId, users.id))
		.where(inArray(conversationParticipants.conversationId, pageIds))
		.orderBy(conversationParticipants.joinedAt);

	const participantsMap = new Map<number, typeof participants>();
	for (const row of participants) {
		if (!participantsMap.has(row.conversationId)) {
			participantsMap.set(row.conversationId, []);
		}
		participantsMap.get(row.conversationId)!.push(row);
	}

	// 6. Unread counts (pushed into SQL): count messages newer than the user's
	// lastReadAt per conversation, excluding the user's OWN messages (so the
	// count is self-contained and does not depend on every writer advancing the
	// read pointer). COALESCE(lastReadAt, 0) treats never-read conversations as
	// unread-from-epoch, so all their messages count.
	const unreadRows = await db
		.select({
			conversationId: messages.conversationId,
			count: sql<number>`COUNT(*)`
		})
		.from(messages)
		.leftJoin(
			conversationReads,
			and(
				eq(conversationReads.conversationId, messages.conversationId),
				eq(conversationReads.userId, userId)
			)
		)
		.where(
			and(
				inArray(messages.conversationId, pageIds),
				ne(messages.authorId, userId),
				sql`${messages.createdAt} > COALESCE(${conversationReads.lastReadAt}, 0)`
			)
		)
		.groupBy(messages.conversationId);
	const unreadMap = new Map<number, number>(unreadRows.map((u) => [u.conversationId, u.count]));

	const items: ConversationListItem[] = pageIds.map((id) => {
		const latest = latestMap.get(id);
		const convParticipants = participantsMap.get(id) ?? [];
		const otherParticipant =
			convParticipants.find((p) => p.userId !== userId) ?? convParticipants[0];
		const displayUser = otherParticipant ?? null;

		return {
			id,
			title: titleMap.get(id) ?? '',
			// Read the typed column (Drizzle converts timestamp mode) rather than the
			// raw MAX() aggregate, which bypasses conversion and would render as the
			// epoch (e.g. "56 years ago") on the client.
			lastMessageAt: latest?.createdAt ?? null,
			// Generous cap so the card's CSS line-clamp-3 is the real visual limiter
			// (≈3 lines on desktop); short messages render in full.
			lastMessagePreview: latest ? extractPlainText(latest.contentJson, 300) : null,
			lastAuthorId: displayUser?.userId ?? null,
			lastAuthorUsername: displayUser?.username ?? null,
			lastAuthorDisplayName: displayUser?.displayName ?? null,
			lastAuthorAvatarFileId: displayUser?.avatarFileId ?? null,
			participantCount: countMap.get(id) ?? 0,
			messageCount: messageCountMap.get(id) ?? 0,
			unreadCount: unreadMap.get(id) ?? 0
		};
	});

	return { items, total };
}

/**
 * Count the active user's total unread private messages across all
 * conversations  - the sum that `getConversations` computes per-conversation
 * (messages newer than the user's lastReadAt, excluding their own messages,
 * in non-deleted conversations they participate in), collapsed to one number.
 * Used by the root layout load to render the message icon badge.
 */
export async function countTotalUnreadMessages(db: D1Db, userId: number): Promise<number> {
	const rows = await db
		.select({ count: sql<number>`COUNT(*)` })
		.from(messages)
		.innerJoin(
			conversationParticipants,
			and(
				eq(conversationParticipants.conversationId, messages.conversationId),
				eq(conversationParticipants.userId, userId)
			)
		)
		.innerJoin(
			conversations,
			and(eq(conversations.id, messages.conversationId), isNull(conversations.deletedAt))
		)
		.leftJoin(
			conversationReads,
			and(
				eq(conversationReads.conversationId, messages.conversationId),
				eq(conversationReads.userId, userId)
			)
		)
		.where(
			and(
				ne(messages.authorId, userId),
				sql`${messages.createdAt} > COALESCE(${conversationReads.lastReadAt}, 0)`
			)
		);
	return rows[0]?.count ?? 0;
}
