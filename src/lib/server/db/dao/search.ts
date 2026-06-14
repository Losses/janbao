import { sql, eq, and, isNull, inArray } from 'drizzle-orm';
import {
	discussions,
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
	getActivitiesLimit
} from '$lib/server/constants';
import { lexicalToSearchText } from '$lib/utils/lexical';

/**
 * Full-text search across the four content kinds. Each kind is searched on its
 * own contentless FTS5 trigram table (rowid = source PK); results map back to
 * the source tables via JOIN.
 *
 * Queries shorter than 3 characters fall back to LIKE on the source tables,
 * because trigram tokens are 3 characters minimum. The `usedFallback` flag on
 * the result tells the UI to note that fuzzy matching is in effect.
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

export interface ActivitySearchItem {
	id: number;
	authorId: number;
	authorDisplayName: string;
	authorUsername: string;
	authorAvatarFileId: string | null;
	recipientId: number | null;
	contentJson: string;
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

export interface DiscussionSearchItem {
	id: number;
	title: string;
	slug: string;
	categorySlug: string;
	categoryTitle: string;
	authorId: number;
	authorDisplayName: string;
	authorUsername: string;
	createdAt: Date;
	updatedAt: Date;
	commentCount: number;
	matchedField: 'title' | 'body';
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
	platformEnv: App.Platform['env'] | undefined
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
	const sorted = fallback
		? [...visible].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
		: [...visible].sort((a, b) => (idToRank.get(a.id) ?? 0) - (idToRank.get(b.id) ?? 0));
	const total = sorted.length;
	const paged = sorted.slice(offset, offset + limit);

	return {
		results: paged.map((r) => ({ ...r, rank: idToRank.get(r.id) ?? 0 })),
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
	platformEnv: App.Platform['env'] | undefined
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

	const sorted = fallback
		? [...allowed].sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
		: [...allowed].sort((a, b) => a.rank - b.rank);
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

	// Hydrate conversation titles.
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

	// Hydrate a preview from the best-ranking message in each conversation.
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
	// LIKE fallback: only search conversations the user is in (cheaper + private).
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
	platformEnv: App.Platform['env'] | undefined
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

	// Category read-permission filter. Load categorySlug per hit, drop unreadable.
	const readable = await getReadableCategorySlugs(db, groupSlug);
	const readableSet = readable === null ? null : new Set(readable);
	const catRows = await db
		.select({ id: discussions.id, categorySlug: discussions.categorySlug })
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
	const catMap = new Map(catRows.map((r) => [r.id, r.categorySlug]));
	const rankMap = new Map(hits.map((h) => [h.id, h]));
	const allowed = catRows
		.map((r) => rankMap.get(r.id))
		.filter((h): h is DiscussionFtsHit => h !== undefined)
		.filter((h) => readableSet === null || readableSet.has(catMap.get(h.id) ?? ''));

	const sorted = fallback
		? [...allowed].sort((a, b) => b.id - a.id)
		: [...allowed].sort((a, b) => a.rank - b.rank);
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
	// Re-attach the search ordering/rank (rows come back unordered from IN).
	const ordered = paged
		.map((h) => {
			const r = rowMap.get(h.id);
			if (!r) return null;
			return { ...r, matchedField: h.matchedField, rank: h.rank };
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
	// Title matches + body (reply) matches, each aggregated to discussion id.
	const [titleRows, bodyRows] = await Promise.all([
		db.all<FtsHit>(sql`
			SELECT discussions_fts.rowid AS id, discussions_fts.rank AS rank
			FROM discussions_fts
			WHERE discussions_fts MATCH ${phrase}
		`),
		db.all<FtsHit>(sql`
			SELECT r.discussion_id AS id, MIN(replies_fts.rank) AS rank
			FROM replies_fts
			JOIN replies r ON r.id = replies_fts.rowid
			JOIN discussions d ON d.id = r.discussion_id
			WHERE replies_fts MATCH ${phrase} AND r.deleted_at IS NULL AND d.deleted_at IS NULL
			GROUP BY r.discussion_id
		`)
	]);

	// Merge: a discussion may match in both; keep the better (lower) rank and a
	// preferred matchedField (title wins on ties for clarity).
	const merged = new Map<number, DiscussionFtsHit>();
	for (const t of titleRows) {
		merged.set(t.id, { id: t.id, rank: t.rank, matchedField: 'title' });
	}
	for (const b of bodyRows) {
		const existing = merged.get(b.id);
		if (!existing || b.rank < existing.rank) {
			merged.set(b.id, { id: b.id, rank: b.rank, matchedField: 'body' });
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
		db.all<IdLikeHit>(sql`
			SELECT DISTINCT r.discussion_id AS id
			FROM replies r
			JOIN discussions d ON d.id = r.discussion_id
			WHERE r.deleted_at IS NULL AND d.deleted_at IS NULL
			  AND r.content_json LIKE ${pattern} ESCAPE '\\'
			LIMIT ${LIKE_FALLBACK_LIMIT}
		`)
	]);
	const merged = new Map<number, DiscussionFtsHit>();
	for (const t of titleRows) merged.set(t.id, { id: t.id, rank: 0, matchedField: 'title' });
	for (const b of bodyRows) {
		if (!merged.has(b.id)) merged.set(b.id, { id: b.id, rank: 0, matchedField: 'body' });
	}
	return [...merged.values()];
}

function truncate(text: string, max = 120): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max).trimEnd()}…`;
}
