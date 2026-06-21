/**
 * Database maintenance feature wire types (shared between server and client).
 * Server-internal details (DB handles, raw-SQL row shapes) live in
 * src/lib/server/maintenance.ts; the client only ever sees these serializable
 * shapes - mirroring how src/lib/types/backup.ts splits from backup.ts.
 */

export type MaintenanceOp =
	| 'analyze'
	| 'integrityCheck'
	| 'ftsRebuild'
	| 'statsRebuild'
	| 'statsFreeze';

export interface MaintenanceOpStatus {
	/** Whether this op can run on the current platform (local vs D1). */
	available: boolean;
	/** ISO timestamp of the last successful run; null if it has never run. */
	lastRunIso: string | null;
	/** Human-readable result of the last run (e.g. integrity_check output); null when N/A. */
	lastResult: string | null;
}

/** Per-op status keyed by op name, so the UI can render one card per op. */
export type MaintenanceOpsStatus = Record<MaintenanceOp, MaintenanceOpStatus>;

/**
 * Lifecycle of the most recent detached maintenance run, surfaced to the admin
 * UI so it can poll the running → terminal transition without holding the
 * trigger request open. `null` until the first run and after a process restart
 * (in-memory only). Mirrors BackupRunStatus, plus the `op` being run.
 */
export interface MaintenanceRunStatus {
	op: MaintenanceOp;
	state: 'running' | 'succeeded' | 'failed';
	/** ISO timestamp the run started. */
	startedAt: string;
	/** ISO timestamp the run reached a terminal state; null while running. */
	finishedAt: string | null;
	/** Failure message once state is 'failed'; otherwise null. */
	error: string | null;
}

export interface MaintenanceOverview {
	ops: MaintenanceOpsStatus;
	run: MaintenanceRunStatus | null;
}

/** Outcome of executing one op synchronously (analyze) or detached (the heavy two). */
export interface MaintenanceRunResult {
	ok: boolean;
	/** Optional human-readable summary surfaced to the admin. */
	result?: string;
	/** Failure message when ok is false. */
	error?: string;
}
