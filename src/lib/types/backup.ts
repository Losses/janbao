/**
 * Backup feature wire types (shared between server and client).
 * Server-internal types that carry a Date live in src/lib/server/backup.ts;
 * the client only ever sees these serializable shapes.
 */

export interface BackupPolicy {
	enabled: boolean;
	retentionDays: number;
}

export interface BackupListItem {
	name: string;
	/** ISO timestamp parsed from the backup filename's embedded stamp. */
	date: string;
}

/**
 * Lifecycle of the most recent backup run (manual or daily), surfaced to the
 * admin UI so it can poll the running → terminal transition without holding the
 * trigger request open for the whole upload. `null` until the first run and
 * after a process restart (in-memory only).
 */
export interface BackupRunStatus {
	state: 'running' | 'succeeded' | 'failed';
	/** ISO timestamp the run started. */
	startedAt: string;
	/** ISO timestamp the run reached a terminal state; null while running. */
	finishedAt: string | null;
	/** Backup filename once state is 'succeeded'; otherwise null. */
	name: string | null;
	/** Failure message once state is 'failed'; otherwise null. */
	error: string | null;
}
