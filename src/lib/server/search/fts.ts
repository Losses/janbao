import { sql } from 'drizzle-orm';
import type { D1Db, DbTransaction } from '$lib/server/db';
import { lexicalToSearchText } from '$lib/utils/lexical';

/**
 * FTS5 index maintenance for full-text search.
 *
 * CONTRACT — every content write path must keep the FTS tables in sync, or search
 * results go stale (ghost hits on deleted rows, or new rows unsearchable). The
 * callers in the route handlers own the source-table SELECT/INSERT and pass the
 * exact text here; this module never reads source tables. That keeps reindex
 * correct: a contentless FTS delete must resupply the text the row was *indexed
 * with*, which only the caller knows at edit time (the source row may already
 * hold the new value).
 *
 * Tables (contentless, rowid = source PK — see fts-schema.ts):
 *   discussions_fts(title)  replies_fts(body)  activities_fts(body)  messages_fts(body)
 */
export type DbLike = D1Db | DbTransaction;

/** Insert one row into a contentless FTS table. */
async function ftsInsert(
	db: DbLike,
	table: string,
	column: string,
	id: number,
	text: string
): Promise<void> {
	await db.run(
		sql`INSERT INTO ${sql.raw(table)} (rowid, ${sql.raw(column)}) VALUES (${id}, ${text})`
	);
}

/**
 * Delete one row from a contentless FTS table.
 * Contentless tables have no content snapshot, so the original text must be
 * resupplied — FTS5 recomputes the terms from it and removes them from the index.
 */
async function ftsDelete(
	db: DbLike,
	table: string,
	column: string,
	id: number,
	text: string
): Promise<void> {
	await db.run(
		sql`INSERT INTO ${sql.raw(table)} (${sql.raw(table)}, rowid, ${sql.raw(column)}) VALUES ('delete', ${id}, ${text})`
	);
}

// --- Replies ---

export async function indexReply(db: DbLike, id: number, contentJson: string): Promise<void> {
	await ftsInsert(db, 'replies_fts', 'body', id, lexicalToSearchText(contentJson));
}

export async function unindexReply(db: DbLike, id: number, contentJson: string): Promise<void> {
	await ftsDelete(db, 'replies_fts', 'body', id, lexicalToSearchText(contentJson));
}

export async function reindexReply(
	db: DbLike,
	id: number,
	oldContentJson: string,
	newContentJson: string
): Promise<void> {
	await ftsDelete(db, 'replies_fts', 'body', id, lexicalToSearchText(oldContentJson));
	await ftsInsert(db, 'replies_fts', 'body', id, lexicalToSearchText(newContentJson));
}

// --- Activities (top-level posts + comments) ---

export async function indexActivity(db: DbLike, id: number, contentJson: string): Promise<void> {
	await ftsInsert(db, 'activities_fts', 'body', id, lexicalToSearchText(contentJson));
}

export async function unindexActivity(db: DbLike, id: number, contentJson: string): Promise<void> {
	await ftsDelete(db, 'activities_fts', 'body', id, lexicalToSearchText(contentJson));
}

export async function reindexActivity(
	db: DbLike,
	id: number,
	oldContentJson: string,
	newContentJson: string
): Promise<void> {
	await ftsDelete(db, 'activities_fts', 'body', id, lexicalToSearchText(oldContentJson));
	await ftsInsert(db, 'activities_fts', 'body', id, lexicalToSearchText(newContentJson));
}

// --- Messages (no soft-delete path exists, so no unindex) ---

export async function indexMessage(db: DbLike, id: number, contentJson: string): Promise<void> {
	await ftsInsert(db, 'messages_fts', 'body', id, lexicalToSearchText(contentJson));
}

export async function reindexMessage(
	db: DbLike,
	id: number,
	oldContentJson: string,
	newContentJson: string
): Promise<void> {
	await ftsDelete(db, 'messages_fts', 'body', id, lexicalToSearchText(oldContentJson));
	await ftsInsert(db, 'messages_fts', 'body', id, lexicalToSearchText(newContentJson));
}

// --- Discussions (title is plain text, not Lexical JSON) ---

export async function indexDiscussionTitle(db: DbLike, id: number, title: string): Promise<void> {
	await ftsInsert(db, 'discussions_fts', 'title', id, title);
}

export async function unindexDiscussion(db: DbLike, id: number, title: string): Promise<void> {
	await ftsDelete(db, 'discussions_fts', 'title', id, title);
}

export async function reindexDiscussionTitle(
	db: DbLike,
	id: number,
	oldTitle: string,
	newTitle: string
): Promise<void> {
	await ftsDelete(db, 'discussions_fts', 'title', id, oldTitle);
	await ftsInsert(db, 'discussions_fts', 'title', id, newTitle);
}
