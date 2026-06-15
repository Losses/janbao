import { sql, eq, and, isNull, inArray } from 'drizzle-orm';
import {
	discussions,
	replies,
	activities,
	messages,
	conversations,
	conversationParticipants,
	users,
	categories
} from '$lib/server/db/schema';
import type { D1Db } from '$lib/server/db';
import {
	getReadableCategorySlugs,
	getDiscussionsLimit,
	getActivitiesLimit,
	getPaginationLimit
} from '$lib/server/constants';
import { lexicalToSearchText } from '$lib/utils/lexical';

/**
 * Full-text search across the four content kinds. Each kind is searched on its
 * own contentless FTS5 trigram table (rowid = source PK); results map back to
 * the source tables via JOIN.
 *
 * Queries shorter than 3 characters fall back to LIKE on the source tables,
 * because trigram tokens are 3 characters minimum. Result items carry a plain-
 * text preview (extracted via lexicalToSearchText) so the UI can highlight the
 * matched term; the `usedFallback` flag lets the UI note fuzzy matching.
 */

const MIN_FTS_LENGTH = 3;
const LIKE_FALLBACK_LIMIT = 200;

export interface SearchPage<T> {
	results: T[];
	total: number;
	page: number;
	totalPages: number;
	usedFallback: boolean;
}

export type MatchKind = 'title' | 'op' | 'reply';

export type SearchSort = 'newest' | 'oldest' | 'relevance' | 'replies';

export interface DiscussionSearchItem {
	id: number;
	title: string;
	slug: string;
	categorySlug: string;
	categoryTitle: string;
	authorId: number;
	authorDisplayName: string;
	authorUsername: string;
	authorAvatarFileId: string | null;
	createdAt: Date;
	updatedAt: Date;
	commentCount: number;
	/** Plain text of the best-matching reply, when the body matched (null for title-only hits). */
	bodyPreview: string | null;
	/** The reply id the body match came from, for deep-linking (null for title-only hits). */
	bestReplyId: number | null;
	/** Whether the hit was in the title, the OP body, or a reply. */
	matchKind: MatchKind;
	/** Page the best reply lands on, for deep-linking (null unless matchKind is 'reply'). */
	replyPage: number | null;
	rank: number;
}

export interface ActivitySearchItem {
	id: number;
	authorId: number;
	authorDisplayName: string;
	authorUsername: string;
	authorAvatarFileId: string | null;
	recipientId: number | null;
	previewText: string;
	createdAt: Date;
	rank: number;
}

export interface MessageSearchItem {
	conversationId: number;
	title: string;
	hitCount: number;
	previewText: string;
	lastMessageAt: Date;
	rank: number;
}

interface FtsHit {
	id: number;
	rank: number;
}

interface IdLikeHit {
	id: number;
}

interface DiscussionFtsHit {
	id: number;
	rank: number;
	matchedField: 'title' | 'body';
	bestReplyId?: number;
}

interface DiscussionBodyHit {
	id: number;
	replyId: number;
	rank: number;
}

interface BestBodyHit {
	replyId: number;
	rank: number;
}

interface ReplyIdHit {
	id: number;
	replyId: number;
}

interface ReplyPosition {
	replyId: number;
	position: number;
}

interface ConversationFtsHit {
	conversationId: number;
	rank: number;
	hitCount: number;
	previewMessageId: number;
	lastMessageAt: Date;
}

/** Strip FTS5 operators and wrap as a phrase so trigram does substring matching. */
function cleanFtsQuery(q: string): string {
	const cleaned = q
		.replace(/["*()^:]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return `"${cleaned}"`;
}

/** Escape LIKE wildcards so a short user term is matched literally. */
function escapeLike(q: string): string {
	return q.replace(/[%_\\]/g, '\\$&');
}

function emptyPage<T>(page: number): SearchPage<T> {
	return { results: [], total: 0, page, totalPages: 0, usedFallback: false };
}

// ============================================================
// Activities
// ============================================================

export async function searchActivities(
	db: D1Db,
	query: string,
	userId: number,
	page: number,
	platformEnv: App.Platform['env'] | undefined,
	sort: SearchSort = 'newest'
): Promise<SearchPage<ActivitySearchItem>> {
	const trimmed = query.trim();
	if (trimmed.length === 0) return emptyPage(page);

	const limit = getActivitiesLimit(platformEnv);
	const offset = (page - 1) * limit;
	const fallback = trimmed.length < MIN_FTS_LENGTH;

	const hits = fallback
		? await activitiesLikeHits(db, escapeLike(trimmed))
		: await activitiesFtsHits(db, cleanFtsQuery(trimmed));
	if (hits.length === 0) return { ...emptyPage<ActivitySearchItem>(page), usedFallback: fallback };

	const idToRank = new Map(hits.map((h) => [h.id, h.rank]));
	const rows = await db
		.select({
			id: activities.id,
			authorId: activities.authorId,
			authorDisplayName: users.displayName,
			authorUsername: users.username,
			authorAvatarFileId: users.avatarFileId,
			recipientId: activities.recipientId,
			contentJson: activities.contentJson,
			createdAt: activities.createdAt
		})
		.from(activities)
		.innerJoin(users, eq(activities.authorId, users.id))
		.where(
			and(
				inArray(activities.id, [...idToRank.keys()]),
				isNull(activities.deletedAt),
				isNull(activities.parentActivityId)
			)
		);

	// Visibility: public activity, an activity addressed to me, or one I authored.
	const visible = rows.filter(
		(r) => r.recipientId === null || r.recipientId === userId || r.authorId === userId
	);
	const ranked = (id: number) => idToRank.get(id) ?? 0;
	// Activities have no reply count; 'replies' falls back to newest.
	const sorted = [...visible].sort((a, b) => {
		switch (sort) {
			case 'oldest':
				return a.createdAt.getTime() - b.createdAt.getTime();
			case 'relevance':
				return fallback
					? b.createdAt.getTime() - a.createdAt.getTime()
					: ranked(a.id) - ranked(b.id);
			default:
				return b.createdAt.getTime() - a.createdAt.getTime();
		}
	});
	const total = sorted.length;
	const paged = sorted.slice(offset, offset + limit);

	return {
		results: paged.map((r) => ({
			id: r.id,
			authorId: r.authorId,
			authorDisplayName: r.authorDisplayName,
			authorUsername: r.authorUsername,
			authorAvatarFileId: r.authorAvatarFileId,
			recipientId: r.recipientId,
			previewText: lexicalToSearchText(r.contentJson),
			createdAt: r.createdAt,
			rank: idToRank.get(r.id) ?? 0
		})),
		total,
		page,
		totalPages: Math.max(1, Math.ceil(total / limit)),
		usedFallback: fallback
	};
}

async function activitiesFtsHits(db: D1Db, phrase: string): Promise<FtsHit[]> {
	return db.all<FtsHit>(sql`
		SELECT CASE WHEN a.parent_activity_id IS NOT NULL THEN a.parent_activity_id ELSE a.id END AS id,
		       MIN(activities_fts.rank) AS rank
		FROM activities_fts
		JOIN activities a ON a.id = activities_fts.rowid
		WHERE activities_fts MATCH ${phrase} AND a.deleted_at IS NULL
		GROUP BY id
	`);
}

async function activitiesLikeHits(db: D1Db, term: string): Promise<FtsHit[]> {
	const pattern = `%${term}%`;
	const rows = await db.all<IdLikeHit>(sql`
		SELECT DISTINCT CASE WHEN a.parent_activity_id IS NOT NULL THEN a.parent_activity_id ELSE a.id END AS id
		FROM activities a
		WHERE a.deleted_at IS NULL AND a.content_json LIKE ${pattern} ESCAPE '\\'
		LIMIT ${LIKE_FALLBACK_LIMIT}
	`);
	return rows.map((r) => ({ id: r.id, rank: 0 }));
}

// ============================================================
// Messages (aggregated to conversation)
// ============================================================

export async function searchMessages(
	db: D1Db,
	query: string,
	userId: number,
	page: number,
	platformEnv: App.Platform['env'] | undefined,
	sort: SearchSort = 'newest'
): Promise<SearchPage<MessageSearchItem>> {
	const trimmed = query.trim();
	if (trimmed.length === 0) return emptyPage(page);

	const limit = getActivitiesLimit(platformEnv);
	const offset = (page - 1) * limit;
	const fallback = trimmed.length < MIN_FTS_LENGTH;

	const hits = fallback
		? await messagesLikeHits(db, escapeLike(trimmed), userId)
		: await messagesFtsHits(db, cleanFtsQuery(trimmed));
	if (hits.length === 0) return { ...emptyPage<MessageSearchItem>(page), usedFallback: fallback };

	// Restrict to conversations the user actually participates in.
	const participantRows = await db
		.select({ conversationId: conversationParticipants.conversationId })
		.from(conversationParticipants)
		.where(
			and(
				eq(conversationParticipants.userId, userId),
				inArray(
					conversationParticipants.conversationId,
					hits.map((h) => h.conversationId)
				)
			)
		);
	const participantSet = new Set(participantRows.map((p) => p.conversationId));
	const allowed = hits.filter((h) => participantSet.has(h.conversationId));

	// Messages have no reply count; 'replies' falls back to newest.
	const sorted = [...allowed].sort((a, b) => {
		switch (sort) {
			case 'oldest':
				return a.lastMessageAt.getTime() - b.lastMessageAt.getTime();
			case 'relevance':
				return fallback ? b.lastMessageAt.getTime() - a.lastMessageAt.getTime() : a.rank - b.rank;
			default:
				return b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
		}
	});
	const total = sorted.length;
	const paged = sorted.slice(offset, offset + limit);

	if (paged.length === 0) {
		return {
			results: [],
			total,
			page,
			totalPages: Math.max(1, Math.ceil(total / limit)),
			usedFallback: fallback
		};
	}

	const convRows = await db
		.select({ id: conversations.id, title: conversations.title })
		.from(conversations)
		.where(
			and(
				inArray(
					conversations.id,
					paged.map((h) => h.conversationId)
				),
				isNull(conversations.deletedAt)
			)
		);
	const titleMap = new Map(convRows.map((c) => [c.id, c.title]));

	const previewRows = await db
		.select({
			id: messages.id,
			conversationId: messages.conversationId,
			contentJson: messages.contentJson
		})
		.from(messages)
		.where(
			inArray(
				messages.id,
				paged.map((h) => h.previewMessageId)
			)
		);
	const previewMap = new Map(previewRows.map((r) => [r.id, r.contentJson]));

	return {
		results: paged.map((h) => ({
			conversationId: h.conversationId,
			title: titleMap.get(h.conversationId) ?? '',
			hitCount: h.hitCount,
			previewText: truncate(lexicalToSearchText(previewMap.get(h.previewMessageId) ?? '')),
			lastMessageAt: h.lastMessageAt,
			rank: h.rank
		})),
		total,
		page,
		totalPages: Math.max(1, Math.ceil(total / limit)),
		usedFallback: fallback
	};
}

async function messagesFtsHits(db: D1Db, phrase: string): Promise<ConversationFtsHit[]> {
	return db.all<ConversationFtsHit>(sql`
		SELECT m.conversation_id AS conversationId,
		       MIN(messages_fts.rank) AS rank,
		       COUNT(*) AS hitCount,
		       (SELECT m2.id FROM messages_fts
		          JOIN messages m2 ON m2.id = messages_fts.rowid
		          WHERE messages_fts MATCH ${phrase} AND m2.conversation_id = m.conversation_id
		          ORDER BY messages_fts.rank LIMIT 1) AS previewMessageId,
		       MAX(m.created_at) AS lastMessageAt
		FROM messages_fts
		JOIN messages m ON m.id = messages_fts.rowid
		JOIN conversations c ON c.id = m.conversation_id
		WHERE messages_fts MATCH ${phrase} AND c.deleted_at IS NULL
		GROUP BY m.conversation_id
	`);
}

async function messagesLikeHits(
	db: D1Db,
	term: string,
	userId: number
): Promise<ConversationFtsHit[]> {
	const pattern = `%${term}%`;
	return db.all<ConversationFtsHit>(sql`
		SELECT m.conversation_id AS conversationId,
		       0 AS rank,
		       COUNT(*) AS hitCount,
		       MIN(m.id) AS previewMessageId,
		       MAX(m.created_at) AS lastMessageAt
		FROM messages m
		JOIN conversations c ON c.id = m.conversation_id
		JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
		WHERE m.content_json LIKE ${pattern} ESCAPE '\\'
		  AND c.deleted_at IS NULL
		  AND cp.user_id = ${userId}
		GROUP BY m.conversation_id
		LIMIT ${LIKE_FALLBACK_LIMIT}
	`);
}

// ============================================================
// Discussions (title + body aggregated to discussion)
// ============================================================

export async function searchDiscussions(
	db: D1Db,
	query: string,
	userId: number | null,
	groupSlug: string,
	page: number,
	platformEnv: App.Platform['env'] | undefined,
	sort: SearchSort = 'newest'
): Promise<SearchPage<DiscussionSearchItem>> {
	const trimmed = query.trim();
	if (trimmed.length === 0) return emptyPage(page);

	const limit = getDiscussionsLimit(platformEnv);
	const offset = (page - 1) * limit;
	const fallback = trimmed.length < MIN_FTS_LENGTH;

	const hits = fallback
		? await discussionsLikeHits(db, escapeLike(trimmed))
		: await discussionsFtsHits(db, cleanFtsQuery(trimmed));
	if (hits.length === 0)
		return { ...emptyPage<DiscussionSearchItem>(page), usedFallback: fallback };

	// Category read-permission filter + sort metadata (createdAt, commentCount).
	const readable = await getReadableCategorySlugs(db, groupSlug);
	const readableSet = readable === null ? null : new Set(readable);
	const metaRows = await db
		.select({
			id: discussions.id,
			categorySlug: discussions.categorySlug,
			createdAt: discussions.createdAt,
			commentCount: discussions.commentCount
		})
		.from(discussions)
		.where(
			and(
				inArray(
					discussions.id,
					hits.map((h) => h.id)
				),
				isNull(discussions.deletedAt)
			)
		);
	const metaMap = new Map(metaRows.map((r) => [r.id, r]));
	const allowed = hits.filter((h) => {
		const m = metaMap.get(h.id);
		return m !== undefined && (readableSet === null || readableSet.has(m.categorySlug));
	});

	const sorted = [...allowed].sort((a, b) => {
		const ma = metaMap.get(a.id);
		const mb = metaMap.get(b.id);
		if (!ma || !mb) return 0;
		switch (sort) {
			case 'oldest':
				return ma.createdAt.getTime() - mb.createdAt.getTime();
			case 'relevance':
				return fallback ? mb.createdAt.getTime() - ma.createdAt.getTime() : a.rank - b.rank;
			case 'replies':
				return mb.commentCount - ma.commentCount;
			default:
				return mb.createdAt.getTime() - ma.createdAt.getTime();
		}
	});
	const total = sorted.length;
	const paged = sorted.slice(offset, offset + limit);

	if (paged.length === 0) {
		return {
			results: [],
			total,
			page,
			totalPages: Math.max(1, Math.ceil(total / limit)),
			usedFallback: fallback
		};
	}

	const rows = await db
		.select({
			id: discussions.id,
			title: discussions.title,
			slug: discussions.slug,
			categorySlug: discussions.categorySlug,
			categoryTitle: categories.title,
			authorId: discussions.authorId,
			authorDisplayName: users.displayName,
			authorUsername: users.username,
			authorAvatarFileId: users.avatarFileId,
			createdAt: discussions.createdAt,
			updatedAt: discussions.updatedAt,
			commentCount: discussions.commentCount
		})
		.from(discussions)
		.innerJoin(categories, eq(discussions.categorySlug, categories.slug))
		.innerJoin(users, eq(discussions.authorId, users.id))
		.where(
			and(
				inArray(
					discussions.id,
					paged.map((h) => h.id)
				),
				isNull(discussions.deletedAt)
			)
		);
	const rowMap = new Map(rows.map((r) => [r.id, r]));

	// Fetch plain-text preview for body hits (the best-matching reply's content).
	const bestReplyIds = paged
		.map((h) => h.bestReplyId)
		.filter((id): id is number => id !== undefined);
	const bodyPreviewMap = new Map<number, string>();
	if (bestReplyIds.length > 0) {
		const replyRows = await db
			.select({ id: replies.id, contentJson: replies.contentJson })
			.from(replies)
			.where(inArray(replies.id, bestReplyIds));
		for (const r of replyRows) {
			bodyPreviewMap.set(r.id, lexicalToSearchText(r.contentJson));
		}
	}

	// For body hits, compute each best reply's floor position so the card can
	// deep-link to the right page + anchor, and detect whether it is the OP.
	const replyPosition = new Map<number, number>();
	if (bestReplyIds.length > 0) {
		const idList = sql.join(
			bestReplyIds.map((id) => sql`${id}`),
			sql`, `
		);
		const posRows = await db.all<ReplyPosition>(sql`
			SELECT r.id AS replyId,
			       (SELECT COUNT(*) FROM replies r2
			         WHERE r2.discussion_id = r.discussion_id AND r2.deleted_at IS NULL
			           AND (r2.created_at < r.created_at
			                OR (r2.created_at = r.created_at AND r2.id < r.id))) + 1 AS position
			FROM replies r
			WHERE r.id IN (${idList}) AND r.deleted_at IS NULL
		`);
		for (const p of posRows) replyPosition.set(p.replyId, p.position);
	}
	const replyLimit = getPaginationLimit(platformEnv);

	const ordered = paged
		.map((h) => {
			const r = rowMap.get(h.id);
			if (!r) return null;
			const bestReplyId = h.bestReplyId ?? null;
			const position = bestReplyId !== null ? (replyPosition.get(bestReplyId) ?? null) : null;
			const matchKind: MatchKind = bestReplyId === null ? 'title' : position === 1 ? 'op' : 'reply';
			const replyPage =
				bestReplyId !== null && position !== null && position > 1
					? Math.ceil((position - 1) / replyLimit)
					: null;
			return {
				...r,
				bodyPreview: bestReplyId !== null ? (bodyPreviewMap.get(bestReplyId) ?? null) : null,
				bestReplyId,
				matchKind,
				replyPage,
				rank: h.rank
			};
		})
		.filter((r): r is DiscussionSearchItem => r !== null);

	return {
		results: ordered,
		total,
		page,
		totalPages: Math.max(1, Math.ceil(total / limit)),
		usedFallback: fallback
	};
}

async function discussionsFtsHits(db: D1Db, phrase: string): Promise<DiscussionFtsHit[]> {
	const [titleRows, bodyRows] = await Promise.all([
		db.all<FtsHit>(sql`
			SELECT discussions_fts.rowid AS id, discussions_fts.rank AS rank
			FROM discussions_fts
			WHERE discussions_fts MATCH ${phrase}
		`),
		db.all<DiscussionBodyHit>(sql`
			SELECT r.discussion_id AS id, r.id AS replyId, replies_fts.rank AS rank
			FROM replies_fts
			JOIN replies r ON r.id = replies_fts.rowid
			JOIN discussions d ON d.id = r.discussion_id
			WHERE replies_fts MATCH ${phrase} AND r.deleted_at IS NULL AND d.deleted_at IS NULL
		`)
	]);

	// Per discussion, keep the best-ranking body hit.
	const bestBody = new Map<number, BestBodyHit>();
	for (const b of bodyRows) {
		const existing = bestBody.get(b.id);
		if (!existing || b.rank < existing.rank)
			bestBody.set(b.id, { replyId: b.replyId, rank: b.rank });
	}

	const merged = new Map<number, DiscussionFtsHit>();
	for (const t of titleRows) merged.set(t.id, { id: t.id, rank: t.rank, matchedField: 'title' });
	for (const [discId, best] of bestBody) {
		const existing = merged.get(discId);
		if (!existing || best.rank < existing.rank) {
			merged.set(discId, {
				id: discId,
				rank: best.rank,
				matchedField: 'body',
				bestReplyId: best.replyId
			});
		}
	}
	return [...merged.values()];
}

async function discussionsLikeHits(db: D1Db, term: string): Promise<DiscussionFtsHit[]> {
	const pattern = `%${term}%`;
	const [titleRows, bodyRows] = await Promise.all([
		db.all<IdLikeHit>(sql`
			SELECT id FROM discussions
			WHERE deleted_at IS NULL AND title LIKE ${pattern} ESCAPE '\\'
			LIMIT ${LIKE_FALLBACK_LIMIT}
		`),
		db.all<ReplyIdHit>(sql`
			SELECT r.discussion_id AS id, r.id AS replyId
			FROM replies r
			JOIN discussions d ON d.id = r.discussion_id
			WHERE r.deleted_at IS NULL AND d.deleted_at IS NULL
			  AND r.content_json LIKE ${pattern} ESCAPE '\\'
			LIMIT ${LIKE_FALLBACK_LIMIT}
		`)
	]);
	const bestBody = new Map<number, number>();
	for (const b of bodyRows) {
		if (!bestBody.has(b.id)) bestBody.set(b.id, b.replyId);
	}
	const merged = new Map<number, DiscussionFtsHit>();
	for (const t of titleRows) merged.set(t.id, { id: t.id, rank: 0, matchedField: 'title' });
	for (const [discId, replyId] of bestBody) {
		if (!merged.has(discId))
			merged.set(discId, { id: discId, rank: 0, matchedField: 'body', bestReplyId: replyId });
	}
	return [...merged.values()];
}

function truncate(text: string, max = 160): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max).trimEnd()}…`;
}
