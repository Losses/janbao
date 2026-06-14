/**
 * Backfill the FTS5 search index from the local development database.
 *
 * Usage:
 *   bun scripts/backfill-fts.ts
 *
 * Idempotent: clears each FTS table first, so it can be re-run after schema or
 * extractor changes. For production, use the /admin/backfill-fts endpoint, which
 * runs the same logic inside the Worker via the D1 binding.
 */
import { getLocalDb } from '../src/lib/server/db';
import { ensureAndBackfillAll } from '../src/lib/server/search/backfill';

const db = await getLocalDb();
const result = await ensureAndBackfillAll(db);

console.log('FTS backfill complete:');
for (const [table, count] of Object.entries(result)) {
	console.log(`  ${table.padEnd(12)} ${count} rows indexed`);
}
