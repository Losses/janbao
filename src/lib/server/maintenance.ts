import { sql } from 'drizzle-orm';
import type { D1Db } from './db/index';
import { listSettingsByPrefix, setSetting } from './db/dao/app-settings';
import { ensureAndBackfillAll } from './search/backfill';
import type {
	MaintenanceOp,
	MaintenanceOpStatus,
	MaintenanceOpsStatus,
	MaintenanceOverview,
	MaintenanceRunResult,
	MaintenanceRunStatus
} from '$lib/types/maintenance';

// On-demand database maintenance operations an admin can self-serve from
// /admin/maintenance. ANALYZE refreshes query-planner statistics; integrity_check
// validates the SQLite file; FTS rebuild re-runs the search-index backfill the
// import path uses. Each op records its last-run timestamp (and result, when
// meaningful) in the app_settings KV store so the admin has a reference.

export const MAINTENANCE_OPS: readonly MaintenanceOp[] = [
	'analyze',
	'integrityCheck',
	'ftsRebuild'
];

const KV_PREFIX = 'maintenance.';
const LAST_RUN_SUFFIX = '.lastRun';
const LAST_RESULT_SUFFIX = '.lastResult';

function lastRunKey(op: MaintenanceOp): string {
	return `${KV_PREFIX}${op}${LAST_RUN_SUFFIX}`;
}
function lastResultKey(op: MaintenanceOp): string {
	return `${KV_PREFIX}${op}${LAST_RESULT_SUFFIX}`;
}

// ANALYZE is fast and harmless on both local libsql and D1. The two heavier ops
// only run where a detached in-process runner works (local node/bun): on
// Cloudflare Workers there's no persistent in-process state to poll, a full FTS
// reindex would blow CPU limits, and D1 restricts PRAGMA. Mirrors how backups
// gate themselves off on D1.
export function isOpAvailable(op: MaintenanceOp, platform: App.Platform | undefined): boolean {
	if (op === 'analyze') return true;
	return !platform?.env?.D1_DB;
}

// Row shape returned by `PRAGMA integrity_check` ({ integrity_check: 'ok' } on a
// healthy DB, or one row per problem). Named so db.all<T> stays inline-lint-clean.
interface IntegrityCheckRow {
	integrity_check: string;
}

/** Execute one op against the DB. Pure: no KV writes (the caller records the run). */
export async function runMaintenanceOp(db: D1Db, op: MaintenanceOp): Promise<MaintenanceRunResult> {
	try {
		if (op === 'analyze') {
			await db.run(sql`ANALYZE`);
			return { ok: true };
		}
		if (op === 'integrityCheck') {
			const rows = await db.all<IntegrityCheckRow>(sql.raw('PRAGMA integrity_check'));
			const text = rows.map((r) => r.integrity_check).join('; ');
			return { ok: true, result: text || 'ok' };
		}
		const counts = await ensureAndBackfillAll(db);
		const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
		const detail = Object.entries(counts)
			.map(([table, n]) => `${table}=${n}`)
			.join(', ');
		return { ok: true, result: `reindexed ${total} rows (${detail})` };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}

/** Run an op and, on success, persist its last-run timestamp (+ result) to KV. */
export async function runMaintenanceAndRecord(
	db: D1Db,
	op: MaintenanceOp
): Promise<MaintenanceRunResult> {
	const result = await runMaintenanceOp(db, op);
	if (result.ok) {
		await setSetting(db, lastRunKey(op), new Date().toISOString());
		if (result.result != null) await setSetting(db, lastResultKey(op), result.result);
	}
	return result;
}

// --- Detached runner (local only) ----------------------------------------
// Mirrors src/lib/server/backup.ts: a module-level status singleton + a
// single-flight inFlight guard, so the admin UI can poll the running → terminal
// transition without holding the POST open for a long FTS reindex. Lost on
// process restart (in-memory only).
let lastStatus: MaintenanceRunStatus | null = null;
let inFlight: Promise<void> | null = null;

interface MaintenanceTriggerResult {
	started: boolean;
	busy: boolean;
}

/**
 * Launch a detached op (integrity_check / ftsRebuild) and return immediately.
 * `{ busy: true }` if a run is already in flight. The async work records its
 * own last-run on success and updates the in-memory status for polling. Never
 * throws.
 */
export async function startMaintenanceDetached(
	db: D1Db,
	op: MaintenanceOp
): Promise<MaintenanceTriggerResult> {
	if (inFlight) return { started: false, busy: true };
	const startedAt = new Date().toISOString();
	markRunning(op, startedAt);
	// runMaintenanceAndRecord is async but returns a promise synchronously; the
	// inFlight assignment below happens before any await, so the single-flight
	// guard stays sound for a later request in the same tick.
	inFlight = runMaintenanceAndRecord(db, op)
		.then((result) => {
			if (result.ok) markSucceeded(op, startedAt, result);
			else markFailed(op, startedAt, new Error(result.error ?? 'maintenance op failed'));
		})
		.catch((err: unknown) => markFailed(op, startedAt, err))
		.finally(() => {
			inFlight = null;
		});
	return { started: true, busy: false };
}

/** In-memory status of the most recent detached run (null until the first run). */
export function getMaintenanceRunStatus(): MaintenanceRunStatus | null {
	return lastStatus;
}

function markRunning(op: MaintenanceOp, startedAt: string): void {
	lastStatus = { op, state: 'running', startedAt, finishedAt: null, error: null };
}
function markSucceeded(op: MaintenanceOp, startedAt: string, result: MaintenanceRunResult): void {
	lastStatus = {
		op,
		state: 'succeeded',
		startedAt,
		finishedAt: new Date().toISOString(),
		error: result.ok ? null : (result.error ?? null)
	};
}
function markFailed(op: MaintenanceOp, startedAt: string, err: unknown): void {
	lastStatus = {
		op,
		state: 'failed',
		startedAt,
		finishedAt: new Date().toISOString(),
		error: err instanceof Error ? err.message : String(err)
	};
	console.error(`[maintenance] background ${op} failed:`, err);
}

/** Assemble the overview the admin UI renders: per-op availability + last-run, and any in-flight run. */
export async function getMaintenanceOverview(
	db: D1Db,
	platform: App.Platform | undefined
): Promise<MaintenanceOverview> {
	const kv = await listSettingsByPrefix(db, KV_PREFIX);
	const statusFor = (op: MaintenanceOp): MaintenanceOpStatus => ({
		available: isOpAvailable(op, platform),
		lastRunIso: kv[lastRunKey(op)] ?? null,
		lastResult: kv[lastResultKey(op)] ?? null
	});
	const ops: MaintenanceOpsStatus = {
		analyze: statusFor('analyze'),
		integrityCheck: statusFor('integrityCheck'),
		ftsRebuild: statusFor('ftsRebuild')
	};
	return { ops, run: getMaintenanceRunStatus() };
}
