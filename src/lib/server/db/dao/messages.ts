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
	userId: string,
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
			maxAt: sql<Date>`MAX(${messages.createdAt})`
		})
		.from(messages)
		.where(inArray(messages.conversationId, allIds))
		.groupBy(messages.conversationId);
	const lastTimeMap = new Map(lastTimeRows.map((r) => [r.conversationId, r.maxAt]));

	const sortedIds = allIds.sort((a, b) => {
		const aTime = lastTimeMap.get(a)?.getTime() ?? 0;
		const bTime = lastTimeMap.get(b)?.getTime() ?? 0;
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

	// 5. Latest message detail (preview + author) per page conversation
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
			authorDisplayName: users.displayName
		})
		.from(latestSubq)
		.innerJoin(
			messages,
			and(
				eq(messages.conversationId, latestSubq.conversationId),
				eq(messages.createdAt, latestSubq.maxAt)
			)
		)
		.innerJoin(users, eq(messages.authorId, users.id));
	// Tie-break on timestamp ties: keep the row with the largest message id per
	// conversation so the "latest" preview/author is deterministic.
	const latestMap = new Map<string, (typeof latestDetails)[number]>();
	for (const row of latestDetails) {
		const existing = latestMap.get(row.conversationId);
		if (!existing || row.id > existing.id) {
			latestMap.set(row.conversationId, row);
		}
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
	const unreadMap = new Map<string, number>(unreadRows.map((u) => [u.conversationId, u.count]));

	const items: ConversationListItem[] = pageIds.map((id) => {
		const latest = latestMap.get(id);
		return {
			id,
			title: titleMap.get(id) ?? '',
			lastMessageAt: latest?.maxAt ?? null,
			lastMessagePreview: latest ? extractPlainText(latest.contentJson) : null,
			lastAuthorDisplayName: latest?.authorDisplayName ?? null,
			participantCount: countMap.get(id) ?? 0,
			unreadCount: unreadMap.get(id) ?? 0
		};
	});

	return { items, total };
}
