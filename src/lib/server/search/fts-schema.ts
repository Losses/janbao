import { sql } from 'drizzle-orm';
import type { D1Db } from '$lib/server/db';

/**
 * FTS5 trigram virtual tables for full-text search.
 *
 * All four are *contentless* (content=''): FTS5 stores only the inverted index,
 * not the original text, which keeps storage at ~3.5x the plain text (measured)
 * instead of duplicating it. Trade-offs: a contentless table only yields rowid +
 * rank on MATCH, and its delete command must resupply the original text — see
 * src/lib/server/search/fts.ts. Each table's rowid = the source table's PK, so
 * MATCH results map straight back to the source row with no join-table.
 *
 * Idempotent (IF NOT EXISTS): safe to run on every local dev boot and to re-call
 * from the production admin backfill endpoint.
 */
const FTS_TABLE_DDL: string[] = [
	`CREATE VIRTUAL TABLE IF NOT EXISTS discussions_fts USING fts5(title, content='', tokenize='trigram')`,
	`CREATE VIRTUAL TABLE IF NOT EXISTS replies_fts USING fts5(body, content='', tokenize='trigram')`,
	`CREATE VIRTUAL TABLE IF NOT EXISTS activities_fts USING fts5(body, content='', tokenize='trigram')`,
	`CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(body, content='', tokenize='trigram')`
];

/** Create the four contentless FTS5 tables if they do not yet exist. */
export async function ensureFtsSchema(db: D1Db): Promise<void> {
	for (const ddl of FTS_TABLE_DDL) {
		await db.run(sql.raw(ddl));
	}
}

const FTS_TABLE_NAMES: string[] = [
	'discussions_fts',
	'replies_fts',
	'activities_fts',
	'messages_fts'
];

/**
 * Drop and recreate one FTS5 table. Contentless FTS5 tables do not support
 * `DELETE FROM`, so a full clear is done by dropping and re-creating the table.
 * Used by the backfill to make a run idempotent.
 */
export async function rebuildFtsTable(db: D1Db, ftsTable: string): Promise<void> {
	const idx = FTS_TABLE_NAMES.indexOf(ftsTable);
	if (idx < 0) {
		throw new Error(`Unknown FTS table: ${ftsTable}`);
	}
	await db.run(sql.raw(`DROP TABLE IF EXISTS ${ftsTable}`));
	await db.run(sql.raw(FTS_TABLE_DDL[idx]));
}
