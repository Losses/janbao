/**
 * Batch-upload the baked local dev database (.local.db) into Cloudflare D1,
 * *including* the contentless FTS5 shadow tables, so the remote site boots with
 * a working search index - no production-side backfill step required.
 *
 * Usage:
 *   bun scripts/upload-to-d1.ts            # ensure schema + load (resumable) + verify
 *   bun scripts/upload-to-d1.ts --reset    # drop every D1 table first, clear state, then load
 *   bun scripts/upload-to-d1.ts --verify   # count/MATCH checks only (no writes)
 *
 * Requires in .env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID, CLOUDFLARE_D1_TOKEN.
 *
 * Why this ships the FTS tables directly (rather than re-running backfill on D1):
 * backfill-fts is the last step of the *local* bake; the baked .local.db already
 * holds a populated index. We transfer it verbatim. A libsql->libsql round-trip
 * proved that copying the *_data / *_idx / *_docsize / *_config shadow tables
 * preserves MATCH results exactly (identical rowid set), so the same holds on D1.
 *
 * Serialization strategy (the one fiddly part):
 *  - Source tables have NO blob columns -> values go as bound params (text quoting
 *    handled safely by the REST layer; no escaping risk on 650K rows of Lexical JSON).
 *  - FTS shadow tables store the inverted index as BLOBs -> those are inlined as
 *    X'abcd' literals (native SQLite blob syntax the D1 SQL parser parses directly),
 *    sidestepping the D1 REST blob-param encoding format entirely.
 *
 * Idempotent: each not-yet-done table is DELETEd then re-inserted, so re-running
 * after an interruption is safe. Progress is checkpointed to .d1-upload-state.json.
 */
import { createClient } from '@libsql/client';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface EnvCredentials {
	accountId: string;
	databaseId: string;
	token: string;
}

function readCredentials(): EnvCredentials {
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
	const databaseId = process.env.CLOUDFLARE_DATABASE_ID;
	const token = process.env.CLOUDFLARE_D1_TOKEN;
	if (!accountId || !databaseId || !token) {
		throw new Error(
			'Missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_DATABASE_ID / CLOUDFLARE_D1_TOKEN in .env'
		);
	}
	return { accountId, databaseId, token };
}

const CREDENTIALS = readCredentials();
const LOCAL_URL = 'file:.local.db';
const STATE_PATH = '.d1-upload-state.json';
const QUERY_URL = `https://api.cloudflare.com/client/v4/accounts/${CREDENTIALS.accountId}/d1/database/${CREDENTIALS.databaseId}/query`;

/** Bound params per statement - keep well under SQLite's variable limit. */
const MAX_PARAMS = 800;
/** Rows per multi-row INSERT (also bounded by MAX_PARAMS / ncols). */
const MAX_ROWS = 1000;
/** Soft cap on the SQL text of one INSERT body. */
const MAX_BODY_BYTES = 384 * 1024;
/** Concurrent in-flight D1 write requests. */
const CONCURRENCY = 6;
/** Rows fetched per round-trip from the local DB while streaming. */
const STREAM_CHUNK = 4000;

// ---------------------------------------------------------------------------
// D1 REST client
// ---------------------------------------------------------------------------

type SqlParam = string | number | null;

interface D1Meta {
	changes?: number;
	rows_read?: number;
	duration?: number;
}

interface D1StatementResult {
	success: boolean;
	meta: D1Meta;
	results?: Record<string, unknown>[];
}

interface D1Error {
	code: number;
	message: string;
}

interface D1Response {
	success: boolean;
	errors?: D1Error[];
	messages?: unknown[];
	result?: D1StatementResult[];
}

const MAX_RETRIES = 5;

function isTransient(status: number, err: unknown): boolean {
	if (status === 429 || status === 502 || status === 503 || status >= 500) return true;
	if (err !== null && typeof err === 'object' && 'name' in err) {
		const name = String((err as { name: unknown }).name);
		if (name === 'TypeError' || name === 'ConnectionError') return true;
	}
	return false;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Execute one SQL statement on D1 with bounded retry on transient failures. */
async function d1Exec(
	credentials: EnvCredentials,
	sql: string,
	params: SqlParam[] = []
): Promise<D1StatementResult> {
	const body = JSON.stringify({ sql, params });
	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		let response: Response;
		try {
			response = await fetch(QUERY_URL, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${credentials.token}`,
					'Content-Type': 'application/json'
				},
				body
			});
		} catch (err) {
			if (attempt < MAX_RETRIES - 1 && isTransient(0, err)) {
				await sleep(2 ** attempt * 500);
				continue;
			}
			throw err;
		}
		const json = (await response.json()) as D1Response;
		if (response.ok && json.success && json.result && json.result[0]?.success) {
			return json.result[0];
		}
		// D1 sometimes returns 200 + success:false for a row-level error.
		const errMsg = JSON.stringify(json.errors ?? json);
		const transient = !response.ok && isTransient(response.status, null);
		if (transient && attempt < MAX_RETRIES - 1) {
			await sleep(2 ** attempt * 500);
			continue;
		}
		throw new Error(`D1 query failed (${response.status}): ${errMsg}\n  sql: ${sql.slice(0, 300)}`);
	}
	throw new Error(`D1 query exhausted retries: ${sql.slice(0, 200)}`);
}

async function d1Scalar(credentials: EnvCredentials, sql: string): Promise<unknown> {
	const r = await d1Exec(credentials, sql);
	return r.results?.[0] ? Object.values(r.results[0])[0] : null;
}

async function d1Rows(
	credentials: EnvCredentials,
	sql: string
): Promise<Record<string, unknown>[]> {
	const r = await d1Exec(credentials, sql);
	return r.results ?? [];
}

// ---------------------------------------------------------------------------
// Value serialization
// ---------------------------------------------------------------------------

function bytesToHex(input: ArrayBuffer | ArrayBufferView): string {
	const view =
		input instanceof ArrayBuffer
			? new Uint8Array(input)
			: new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	let hex = '';
	for (const byte of view) hex += byte.toString(16).padStart(2, '0');
	return `X'${hex}'`;
}

/** Inline SQL literal for a single value (used for FTS shadow rows incl. blobs). */
function literal(value: unknown): string {
	if (value === null || value === undefined) return 'NULL';
	if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return bytesToHex(value);
	if (typeof value === 'bigint') return value.toString();
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
	if (typeof value === 'boolean') return value ? '1' : '0';
	return `'${String(value).replace(/'/g, "''")}'`;
}

/** Coerce a value to a REST bind param (source tables have no blobs by contract). */
function toParam(value: unknown): SqlParam {
	if (value === null || value === undefined) return null;
	if (typeof value === 'bigint') {
		if (value > Number.MAX_SAFE_INTEGER || value < Number.MIN_SAFE_INTEGER) {
			throw new Error(`bigint out of safe range for D1 param: ${value}`);
		}
		return Number(value);
	}
	if (typeof value === 'number') return value;
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
		throw new Error('unexpected blob in a param-bound (source) table');
	}
	return String(value);
}

// ---------------------------------------------------------------------------
// Table introspection
// ---------------------------------------------------------------------------

type TableKind = 'source' | 'virtual' | 'shadow';

interface TableSpec {
	name: string;
	ddl: string;
	kind: TableKind;
	/** For shadow tables, the owning virtual table name. */
	vtable: string | null;
	hasBlob: boolean;
	columns: string[];
	hasRowid: boolean;
}

const SHADOW_RE = /^(.+_fts)_(data|idx|docsize|config)$/;

interface ColumnInfo {
	columns: string[];
	hasBlob: boolean;
}

async function tableColumns(
	local: ReturnType<typeof createClient>,
	table: string
): Promise<ColumnInfo> {
	const info = await local.execute(`PRAGMA table_info("${table}")`);
	const columns: string[] = [];
	let hasBlob = false;
	for (const row of info.rows) {
		columns.push(String(row.name));
		if (String(row.type).toLowerCase() === 'blob') hasBlob = true;
	}
	return { columns, hasBlob };
}

async function hasRowidColumn(
	local: ReturnType<typeof createClient>,
	table: string
): Promise<boolean> {
	try {
		await local.execute(`SELECT rowid FROM "${table}" LIMIT 1`);
		return true;
	} catch {
		return false;
	}
}

async function classifyTables(local: ReturnType<typeof createClient>): Promise<TableSpec[]> {
	const master = await local.execute(
		`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY rowid`
	);
	const allNames = new Set(master.rows.map((r) => String(r.name)));
	const specs: TableSpec[] = [];
	for (const row of master.rows) {
		const name = String(row.name);
		const ddl = String(row.sql ?? '');
		const isVirtual = /CREATE\s+VIRTUAL\s+TABLE/i.test(ddl);
		const shadowMatch = name.match(SHADOW_RE);
		let kind: TableKind;
		let vtable: string | null = null;
		if (isVirtual) {
			kind = 'virtual';
		} else if (shadowMatch && allNames.has(shadowMatch[1])) {
			kind = 'shadow';
			vtable = shadowMatch[1];
		} else {
			kind = 'source';
		}
		// Shadow tables are auto-created by their virtual table; we never CREATE them.
		const { columns, hasBlob } =
			kind === 'virtual' ? { columns: [], hasBlob: false } : await tableColumns(local, name);
		const hasRowid =
			kind === 'virtual' ? false : columns.length === 0 ? true : await hasRowidColumn(local, name);
		specs.push({ name, ddl, kind, vtable, hasBlob, columns, hasRowid });
	}
	return specs;
}

/** Order source tables so every table is loaded after its FK parents. */
async function sourceLoadOrder(
	local: ReturnType<typeof createClient>,
	sources: TableSpec[]
): Promise<TableSpec[]> {
	const names = sources.map((s) => s.name);
	const nameSet = new Set(names);
	const deps = new Map<string, Set<string>>();
	for (const spec of sources) {
		const parents = new Set<string>();
		const fk = await local.execute({ sql: `PRAGMA foreign_key_list("${spec.name}")` });
		for (const row of fk.rows) {
			const parent = String(row.table);
			if (nameSet.has(parent) && parent !== spec.name) parents.add(parent);
		}
		deps.set(spec.name, parents);
	}
	const ordered: TableSpec[] = [];
	const done = new Set<string>();
	let progressed = true;
	while (ordered.length < sources.length && progressed) {
		progressed = false;
		for (const spec of sources) {
			if (done.has(spec.name)) continue;
			const parents = deps.get(spec.name) ?? new Set<string>();
			if ([...parents].every((p) => done.has(p))) {
				ordered.push(spec);
				done.add(spec.name);
				progressed = true;
			}
		}
	}
	// Any leftover (FK cycle) appended in original order.
	for (const spec of sources) if (!done.has(spec.name)) ordered.push(spec);
	return ordered;
}

// ---------------------------------------------------------------------------
// Concurrency pool
// ---------------------------------------------------------------------------

type AsyncMapper<T, R> = (item: T, index: number) => Promise<R>;

async function mapPool<T, R>(
	items: T[],
	concurrency: number,
	mapper: AsyncMapper<T, R>
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let cursor = 0;
	async function worker(): Promise<void> {
		while (cursor < items.length) {
			const index = cursor++;
			results[index] = await mapper(items[index], index);
		}
	}
	const workerCount = Math.min(concurrency, items.length);
	const workers: Promise<void>[] = [];
	for (let i = 0; i < workerCount; i++) workers.push(worker());
	await Promise.all(workers);
	return results;
}

// ---------------------------------------------------------------------------
// Resume state
// ---------------------------------------------------------------------------

interface UploadState {
	tables: Record<string, boolean>;
}

function loadState(): UploadState {
	if (!existsSync(STATE_PATH)) return { tables: {} };
	try {
		return JSON.parse(readFileSync(STATE_PATH, 'utf-8')) as UploadState;
	} catch {
		return { tables: {} };
	}
}

function saveState(state: UploadState): void {
	writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Schema creation
// ---------------------------------------------------------------------------

async function ensureSchema(credentials: EnvCredentials, specs: TableSpec[]): Promise<void> {
	const existing = new Set(
		(await d1Rows(credentials, `SELECT name FROM sqlite_master WHERE type = 'table'`)).map((r) =>
			String(r.name)
		)
	);
	let created = 0;
	for (const spec of specs) {
		if (spec.kind === 'shadow') continue; // auto-created by the virtual table
		if (existing.has(spec.name)) continue;
		// Source DDL lacks IF NOT EXISTS; make creation idempotent for re-runs.
		const ddl =
			spec.kind === 'source'
				? spec.ddl.replace(/^(CREATE\s+TABLE)\s+/i, '$1 IF NOT EXISTS ')
				: spec.ddl; // virtual tables already carry IF NOT EXISTS
		await d1Exec(credentials, ddl);
		created++;
	}
	console.log(
		`Schema: ensured ${specs.length} tables (${created} created on D1, ${specs.length - created} already present).`
	);
}

async function dropAllTables(credentials: EnvCredentials, specs: TableSpec[]): Promise<void> {
	// Drop children before parents: reverse of declaration order, shadows before virtuals.
	const dropOrder = [...specs].reverse();
	for (const spec of dropOrder) {
		await d1Exec(credentials, `DROP TABLE IF EXISTS "${spec.name}"`);
	}
	console.log(`Reset: dropped ${specs.length} tables from D1.`);
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

interface InsertStatement {
	sql: string;
	params: SqlParam[];
	rowDelta: number;
}

/** Build a multi-row INSERT. Params mode for blob-free tables, literals for blob tables. */
function buildInsert(
	table: string,
	columns: string[],
	rows: Record<string, unknown>[],
	useLiterals: boolean
): InsertStatement {
	const quotedCols = columns.map((c) => `"${c}"`).join(', ');
	if (useLiterals) {
		const tuples = rows
			.map((row) => `(${columns.map((c) => literal(row[c])).join(', ')})`)
			.join(', ');
		return {
			sql: `INSERT INTO "${table}" (${quotedCols}) VALUES ${tuples}`,
			params: [],
			rowDelta: rows.length
		};
	}
	const placeholder = `(${columns.map(() => '?').join(', ')})`;
	const tuples = rows.map(() => placeholder).join(', ');
	const params: SqlParam[] = [];
	for (const row of rows) {
		for (const col of columns) params.push(toParam(row[col]));
	}
	return {
		sql: `INSERT INTO "${table}" (${quotedCols}) VALUES ${tuples}`,
		params,
		rowDelta: rows.length
	};
}

/** Chunk an array of rows into INSERT statements honoring row/param/body caps. */
function planInserts(
	table: string,
	columns: string[],
	rows: Record<string, unknown>[],
	useLiterals: boolean
): InsertStatement[] {
	const paramBudget = Math.max(1, Math.floor(MAX_PARAMS / Math.max(1, columns.length)));
	const statements: InsertStatement[] = [];
	let batch: Record<string, unknown>[] = [];
	let approxBytes = 0;
	const flush = (): void => {
		if (batch.length > 0) {
			statements.push(buildInsert(table, columns, batch, useLiterals));
			batch = [];
			approxBytes = 0;
		}
	};
	for (const row of rows) {
		batch.push(row);
		approxBytes += 128; // rough per-row estimate
		if (batch.length >= MAX_ROWS || batch.length >= paramBudget || approxBytes >= MAX_BODY_BYTES) {
			flush();
		}
	}
	flush();
	return statements;
}

async function streamRows(
	local: ReturnType<typeof createClient>,
	spec: TableSpec
): Promise<Record<string, unknown>[]> {
	// All source tables and most shadow tables have a rowid -> keyset-paginate.
	// The WITHOUT ROWID shadow tables (_idx, _config) are tiny -> read all at once.
	if (spec.hasRowid) {
		const all: Record<string, unknown>[] = [];
		let cursor = Number.MIN_SAFE_INTEGER;
		while (true) {
			const res = await local.execute({
				sql: `SELECT rowid AS __rid, * FROM "${spec.name}" WHERE rowid > ? ORDER BY rowid LIMIT ?`,
				args: [cursor, STREAM_CHUNK]
			});
			if (res.rows.length === 0) break;
			for (const row of res.rows) all.push(row as Record<string, unknown>);
			const last = res.rows[res.rows.length - 1] as Record<string, unknown>;
			cursor = Number(last.__rid);
		}
		return all;
	}
	const res = await local.execute(`SELECT * FROM "${spec.name}"`);
	return res.rows as Record<string, unknown>[];
}

async function loadTable(
	credentials: EnvCredentials,
	local: ReturnType<typeof createClient>,
	spec: TableSpec,
	state: UploadState
): Promise<number> {
	if (state.tables[spec.name]) {
		console.log(`  ✓ ${spec.name} - already loaded, skipping`);
		return 0;
	}
	const rows = await streamRows(local, spec);
	// Idempotent: clear any partial data from a prior interrupted run before re-inserting.
	await d1Exec(credentials, `DELETE FROM "${spec.name}"`);
	if (rows.length === 0) {
		console.log(`  • ${spec.name} - 0 rows (schema only)`);
		state.tables[spec.name] = true;
		saveState(state);
		return 0;
	}
	const useLiterals = spec.hasBlob;
	const statements = planInserts(spec.name, spec.columns, rows, useLiterals);
	let inserted = 0;
	await mapPool(statements, CONCURRENCY, async (stmt) => {
		const result = await d1Exec(credentials, stmt.sql, stmt.params);
		inserted += result.meta.changes ?? stmt.rowDelta;
	});
	// Reconcile with the planned count if D1 under-reports changes.
	if (inserted < rows.length) inserted = rows.length;
	state.tables[spec.name] = true;
	saveState(state);
	console.log(
		`  ✓ ${spec.name} - ${rows.length} rows in ${statements.length} stmts${
			spec.hasBlob ? ' (blob literals)' : ''
		}`
	);
	return inserted;
}

async function loadData(
	credentials: EnvCredentials,
	local: ReturnType<typeof createClient>,
	specs: TableSpec[]
): Promise<void> {
	const sources = specs.filter((s) => s.kind === 'source');
	const virtuals = specs.filter((s) => s.kind === 'virtual');
	const shadows = specs.filter((s) => s.kind === 'shadow');
	const orderedSources = await sourceLoadOrder(local, sources);

	const state = loadState();
	let totalRows = 0;

	console.log('\nLoading source tables (FK parent-first):');
	for (const spec of orderedSources) {
		totalRows += await loadTable(credentials, local, spec, state);
	}

	console.log('\nLoading FTS shadow tables (the baked search index):');
	// Group shadow tables under their virtual table for readable logging.
	for (const v of virtuals) {
		const group = shadows.filter((s) => s.vtable === v.name);
		for (const spec of group) {
			totalRows += await loadTable(credentials, local, spec, state);
		}
	}

	console.log(`\nLoad complete: ~${totalRows.toLocaleString()} rows written.`);
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function verify(
	credentials: EnvCredentials,
	local: ReturnType<typeof createClient>,
	specs: TableSpec[]
): Promise<void> {
	console.log('\nVerifying row counts (local vs D1):');
	const sourceNames = specs.filter((s) => s.kind === 'source').map((s) => s.name);
	const ftsVirtuals = specs.filter((s) => s.kind === 'virtual').map((s) => s.name);

	let mismatches = 0;
	const checkCounts = async (names: string[]): Promise<void> => {
		for (const name of names) {
			const localCount = Number(
				(await local.execute(`SELECT COUNT(*) AS n FROM "${name}"`)).rows[0]?.n ?? 0
			);
			const remoteCount = Number(
				await d1Scalar(credentials, `SELECT COUNT(*) AS n FROM "${name}"`)
			);
			const ok = localCount === remoteCount;
			if (!ok) mismatches++;
			console.log(
				`  ${ok ? '✓' : '✗'} ${name.padEnd(26)} local ${String(localCount).padStart(8)}  remote ${String(remoteCount).padStart(8)}`
			);
		}
	};
	await checkCounts(sourceNames);
	await checkCounts(ftsVirtuals);

	// Functional FTS check: MATCH the first discussion title's leading run on both sides.
	const probe = await local.execute(
		`SELECT title FROM discussions WHERE deleted_at IS NULL AND length(title) >= 4 ORDER BY id LIMIT 1`
	);
	if (probe.rows.length > 0) {
		const title = String(probe.rows[0].title);
		const term = title.slice(0, Math.min(6, title.length));
		const localHits = Number(
			(
				await local.execute({
					sql: `SELECT COUNT(*) AS n FROM discussions_fts WHERE title MATCH ?`,
					args: [term]
				})
			).rows[0]?.n ?? 0
		);
		const remoteResult = await d1Exec(
			credentials,
			`SELECT COUNT(*) AS n FROM discussions_fts WHERE title MATCH ?`,
			[term]
		);
		const remoteHits = Number(remoteResult.results?.[0]?.n ?? 0);
		const ok = localHits === remoteHits && remoteHits > 0;
		if (!ok) mismatches++;
		console.log(
			`\n  ${ok ? '✓' : '✗'} FTS MATCH '${term}'  local ${localHits}  remote ${remoteHits}`
		);
	} else {
		console.log('\n  (skipped FTS MATCH probe - no discussions with a >=4-char title)');
	}

	if (mismatches > 0) {
		console.error(`\n❌ ${mismatches} mismatch(es) found.`);
	} else {
		console.log('\n✅ All counts match and FTS is functional.');
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const args = new Set(process.argv.slice(2));
	const doReset = args.has('--reset');
	const verifyOnly = args.has('--verify');

	const local = createClient({ url: LOCAL_URL });
	const specs = await classifyTables(local);
	console.log(
		`Classified ${specs.length} tables: ` +
			`${specs.filter((s) => s.kind === 'source').length} source, ` +
			`${specs.filter((s) => s.kind === 'virtual').length} FTS virtual, ` +
			`${specs.filter((s) => s.kind === 'shadow').length} FTS shadow.`
	);

	if (doReset) {
		await dropAllTables(CREDENTIALS, specs);
		if (existsSync(STATE_PATH)) unlinkSync(STATE_PATH);
	}

	if (!verifyOnly) {
		await ensureSchema(CREDENTIALS, specs);
		await loadData(CREDENTIALS, local, specs);
	}

	await verify(CREDENTIALS, local, specs);
}

main().catch((err) => {
	console.error('Upload failed:', err);
	process.exit(1);
});
