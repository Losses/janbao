/**
 * Apply recrawl-profiles.sql to a libsql DB file (production adapter-node DB).
 *
 * The prod app runs @sveltejs/adapter-node → its DB is a libsql/SQLite file at
 * LOCAL_DB_PATH (e.g. /data/janbao.db), not Cloudflare D1. libsql files are not
 * always safely editable by the stock `sqlite3` CLI (format-version drift), so
 * this applies via @libsql/client in chunked transactions. WAL lets the app keep
 * running during the apply.
 *
 * Usage:
 *   LOCAL_DB_PATH=/data/janbao.db bun run scripts/apply-sql.ts [path-to.sql]
 *
 * The .sql is idempotent (INSERT OR IGNORE + WHERE guards), so re-running after
 * a partial failure is safe.
 */
import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';
import { getErrorMessage } from './import-shared';

interface StatementAcc {
	stmts: string[];
	cur: string;
	inString: boolean;
}

/**
 * Split a SQL script into statements, respecting single-quoted string literals
 * (where '' is an escaped quote and ;/newlines are literal). Needed because
 * crawled bios/usernames can contain ; ' or newlines.
 */
function splitStatements(sql: string): string[] {
	const acc: StatementAcc = { stmts: [], cur: '', inString: false };
	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i];
		acc.cur += ch;
		if (ch === "'") {
			if (acc.inString && sql[i + 1] === "'") {
				acc.cur += sql[i + 1]; // consume the escaped quote
				i++;
				continue;
			}
			acc.inString = !acc.inString;
			continue;
		}
		if (ch === ';' && !acc.inString) {
			const stmt = acc.cur.slice(0, -1).trim();
			if (stmt && !/^(BEGIN|COMMIT)$/i.test(stmt)) acc.stmts.push(stmt);
			acc.cur = '';
		}
	}
	const tail = acc.cur.trim();
	if (tail && !/^(BEGIN|COMMIT)$/i.test(tail)) acc.stmts.push(tail);
	return acc.stmts;
}

async function main(): Promise<void> {
	const sqlPath = process.argv[2] ?? 'recrawl-profiles.sql';
	const dbPath = process.env.LOCAL_DB_PATH ?? '.local.db';
	const raw = readFileSync(sqlPath, 'utf-8');
	// Drop full-line comments before splitting (a '--' inside a string literal is
	// protected by the splitter, but standalone comment lines are noise here).
	const stripped = raw
		.split('\n')
		.filter((l) => !l.trimStart().startsWith('--'))
		.join('\n');
	const stmts = splitStatements(stripped);
	console.log(`apply: ${stmts.length} statements from ${sqlPath} → ${dbPath}`);
	if (stmts.length === 0) return;

	const client = createClient({ url: `file:${dbPath}` });
	// Wait (up to 10s) on write-lock contention instead of failing - lets this run
	// alongside the live app under WAL without skipping statements on a busy db.
	await client.execute('PRAGMA busy_timeout=10000');
	const CHUNK = 200;
	let done = 0;
	let failed = 0;
	for (let i = 0; i < stmts.length; i += CHUNK) {
		const chunk = stmts.slice(i, i + CHUNK);
		try {
			await client.batch(
				chunk.map((sql) => ({ sql, args: [] })),
				'write'
			);
			done += chunk.length;
		} catch (e: unknown) {
			// A single bad statement (a UNIQUE collision that slipped past OR IGNORE,
			// or a malformed row) aborts + rolls back the whole batch. Fall back to
			// per-statement execution so the good statements still apply.
			console.log(`  batch at ${done} failed (${getErrorMessage(e)}); retrying per-statement`);
			for (const sql of chunk) {
				try {
					await client.execute({ sql, args: [] });
					done++;
				} catch (e2: unknown) {
					failed++;
					console.log(`  SKIP: ${sql.slice(0, 90).replace(/\n/g, ' ')} → ${getErrorMessage(e2)}`);
				}
			}
		}
		if (done % 5000 < CHUNK || done + failed >= stmts.length)
			console.log(`  applied ${done}/${stmts.length}${failed ? ` (${failed} skipped)` : ''}`);
	}
	console.log(`apply: done (${done} applied${failed ? `, ${failed} skipped` : ''}).`);
}

main().catch((err) => {
	console.error('Error:', err);
	process.exit(1);
});
