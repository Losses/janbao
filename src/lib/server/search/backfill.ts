import { sql } from 'drizzle-orm';
import type { D1Db } from '$lib/server/db';
import { ensureFtsSchema, rebuildFtsTable } from './fts-schema';
import { lexicalToSearchText } from '$lib/utils/lexical';

/**
 * Backfill the contentless FTS5 tables from the source tables.
 *
 * The indexed text is the *plain-text extraction* of Lexical JSON (not the raw
 * JSON), so backfill must run in JS — a pure-SQL `INSERT ... SELECT` would index
 * JSON structural noise. Idempotent: each table is cleared first, so this is safe
 * to re-run.
 *
 * Two entry points:
 *  - `ensureAndBackfillAll(db)`: clears + fully backfills every table. Use
 *    locally (no wall-time limit) or in a one-off long-running job.
 *  - `backfillTableStep(db, task, lastId, batch)`: processes one batch of one
 *    table and returns a cursor; the admin endpoint loops this to stay within a
 *    Worker's wall-time budget.
 */

const BATCH_SIZE = 500;

interface BackfillRow {
	id: number;
	val: string;
}

interface MinIdRow {
	minId: number;
}

interface IndexedEntry {
	id: number;
	text: string;
}

interface BackfillTask {
	table: string;
	sourceColumn: string;
	ftsTable: string;
	ftsColumn: string;
	useLexical: boolean;
}

interface BackfillStepResult {
	indexed: number;
	nextCursor: number | null;
}

const TASKS: BackfillTask[] = [
	{
		table: 'discussions',
		sourceColumn: 'title',
		ftsTable: 'discussions_fts',
		ftsColumn: 'title',
		useLexical: false
	},
	{
		table: 'replies',
		sourceColumn: 'content_json',
		ftsTable: 'replies_fts',
		ftsColumn: 'body',
		useLexical: true
	},
	{
		table: 'activities',
		sourceColumn: 'content_json',
		ftsTable: 'activities_fts',
		ftsColumn: 'body',
		useLexical: true
	},
	{
		table: 'messages',
		sourceColumn: 'content_json',
		ftsTable: 'messages_fts',
		ftsColumn: 'body',
		useLexical: true
	}
];

/** Ordered task list (discussions → replies → activities → messages). */
export function getBackfillTasks(): BackfillTask[] {
	return TASKS;
}

/** Look up a task by source table name (for the cursor-driven admin endpoint). */
export function findBackfillTask(table: string): BackfillTask | undefined {
	return TASKS.find((t) => t.table === table);
}

/**
 * Initial cursor for keyset pagination. Must start below the minimum id, because
 * imported historical rows use *negative* ids — starting at 0 would skip them.
 */
export async function getBackfillStartCursor(db: D1Db, task: BackfillTask): Promise<number> {
	const row = await db.get<MinIdRow>(sql`SELECT MIN(id) AS minId FROM ${sql.raw(task.table)}`);
	return (row?.minId ?? 1) - 1;
}

async function fetchRows(
	db: D1Db,
	task: BackfillTask,
	lastId: number,
	batch: number
): Promise<BackfillRow[]> {
	// messages has no deleted_at; a message is live while its conversation is.
	if (task.table === 'messages') {
		return db.all<BackfillRow>(sql`
			SELECT m.id, m.content_json AS val
			FROM messages m
			JOIN conversations c ON c.id = m.conversation_id
			WHERE m.id > ${lastId} AND c.deleted_at IS NULL
			ORDER BY m.id LIMIT ${batch}
		`);
	}
	return db.all<BackfillRow>(sql`
		SELECT id, ${sql.raw(task.sourceColumn)} AS val
		FROM ${sql.raw(task.table)}
		WHERE id > ${lastId} AND deleted_at IS NULL
		ORDER BY id LIMIT ${batch}
	`);
}

function toEntries(rows: BackfillRow[], useLexical: boolean): IndexedEntry[] {
	return rows
		.map((r) => ({ id: r.id, text: useLexical ? lexicalToSearchText(r.val) : r.val }))
		.filter((e) => e.text.length > 0);
}

async function insertEntries(db: D1Db, task: BackfillTask, entries: IndexedEntry[]): Promise<void> {
	if (entries.length === 0) return;
	await db.run(sql`
		INSERT INTO ${sql.raw(task.ftsTable)} (rowid, ${sql.raw(task.ftsColumn)})
		VALUES ${sql.join(
			entries.map((e) => sql`(${e.id}, ${e.text})`),
			sql`, `
		)}
	`);
}

/** Process one batch of one table. Returns the cursor for the next call. */
export async function backfillTableStep(
	db: D1Db,
	task: BackfillTask,
	lastId: number,
	batch = BATCH_SIZE
): Promise<BackfillStepResult> {
	const rows = await fetchRows(db, task, lastId, batch);
	if (rows.length === 0) return { indexed: 0, nextCursor: null };
	const entries = toEntries(rows, task.useLexical);
	await insertEntries(db, task, entries);
	return { indexed: entries.length, nextCursor: rows[rows.length - 1].id };
}

/** Clear (drop+recreate, since contentless FTS5 can't DELETE) and backfill one table. */
export async function backfillTable(db: D1Db, task: BackfillTask): Promise<number> {
	await rebuildFtsTable(db, task.ftsTable);
	let lastId = await getBackfillStartCursor(db, task);
	let count = 0;
	while (true) {
		const result = await backfillTableStep(db, task, lastId);
		if (result.nextCursor === null) break;
		count += result.indexed;
		lastId = result.nextCursor;
	}
	return count;
}

/** Ensure the FTS schema exists, then clear + backfill every table. */
export async function ensureAndBackfillAll(db: D1Db): Promise<Record<string, number>> {
	await ensureFtsSchema(db);
	const result: Record<string, number> = {};
	for (const task of TASKS) {
		result[task.table] = await backfillTable(db, task);
	}
	return result;
}
