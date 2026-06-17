/**
 * One-off: verify @libsql/client supports VACUUM INTO to an arbitrary path
 * (the snapshot strategy for the backup feature). Self-contained - creates a
 * throwaway temp db, populates it (incl. a WAL-backed transaction), runs
 * VACUUM INTO, then re-opens the snapshot to confirm integrity + data.
 *
 * Run: `bun scripts/verify-vacuum-into.ts`
 */
import { createClient } from '@libsql/client';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = join(tmpdir(), `janbao-vacuum-into-${process.pid}`);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const srcPath = join(dir, 'src.db');
const snapPath = join(dir, 'snap.db');

const src = createClient({ url: `file:${srcPath}` });
await src.execute('PRAGMA journal_mode=WAL');
await src.execute('PRAGMA busy_timeout=5000');
await src.batch([
	{
		sql: `CREATE TABLE demo (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`,
		args: []
	},
	{ sql: `INSERT INTO demo (body) VALUES (?)`, args: ['hello'] },
	{ sql: `INSERT INTO demo (body) VALUES (?)`, args: ['world'] }
]);

// A committed-but-uncheckpointed txn lives in the WAL; the snapshot must still
// capture it, which is the whole point of VACUUM INTO over copying the main file.
// Use raw BEGIN/COMMIT (not client.transaction) so the row stays in the WAL
// without a checkpoint - and because the local driver's transaction() requires
// an explicit mode string, which we don't need here.
await src.execute('BEGIN');
await src.execute({ sql: `INSERT INTO demo (body) VALUES (?)`, args: ['in-wal'] });
await src.execute('COMMIT');

console.log(`source rows:`, (await src.execute('SELECT COUNT(*) AS n FROM demo')).rows[0]);

// Try VACUUM INTO with a plain filesystem path (no file: prefix).
const triedFormats: string[] = [];
let ok = false;
let lastErr: unknown = null;
for (const targetForm of [`'${snapPath}'`, `'file:${snapPath}'`]) {
	triedFormats.push(targetForm);
	try {
		await src.execute(`VACUUM INTO ${targetForm}`);
		console.log(`VACUUM INTO succeeded with target form: ${targetForm}`);
		ok = true;
		break;
	} catch (err) {
		lastErr = err;
		console.log(`VACUUM INTO failed with target form ${targetForm}:`, (err as Error).message);
	}
}

if (!ok) {
	console.error('\nRESULT: VACUUM INTO NOT supported by this libsql client.');
	console.error('Last error:', lastErr);
	rmSync(dir, { recursive: true, force: true });
	process.exit(1);
}

// Re-open the snapshot with a fresh client and verify integrity + data.
const snap = createClient({ url: `file:${snapPath}` });
const integrity = await snap.execute('PRAGMA integrity_check');
const rows = await snap.execute('SELECT COUNT(*) AS n FROM demo');
console.log(`\nsnapshot integrity_check:`, integrity.rows[0]);
console.log(`snapshot row count:`, rows.rows[0]);

const expected = 3;
const got = Number((rows.rows[0] as Record<string, unknown>).n);
const integrityOk = String((integrity.rows[0] as Record<string, unknown>).integrity_check) === 'ok';

if (integrityOk && got === expected) {
	console.log(
		`\nRESULT: PASS - snapshot is consistent and captured the WAL txn (got ${got}/${expected} rows).`
	);
	rmSync(dir, { recursive: true, force: true });
	process.exit(0);
} else {
	console.error(`\nRESULT: FAIL - integrity=${integrityOk}, rows=${got}/${expected}.`);
	rmSync(dir, { recursive: true, force: true });
	process.exit(1);
}
