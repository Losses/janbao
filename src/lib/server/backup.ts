/**
 * Database backup to pCloud (local node/bun mode only).
 *
 * Snapshots the local SQLite database with `VACUUM INTO` (the Online Backup
 * mechanism: produces a consistent point-in-time copy WITHOUT blocking the
 * application's reads or writes  - unlike plain VACUUM, which takes an
 * exclusive lock). The snapshot is streamed to pCloud under
 * /Janbao/backups and retention trims anything older than `backup.retentionDays`
 * days.
 *
 * Concurrency: an in-process mutex (inFlight) plus a cross-process lockfile
 * (next to LOCAL_DB_PATH) ensure only one backup runs at a time, whether the
 * trigger is the daily auto-run or an admin's "backup now".
 *
 * This module is only ever invoked from the !d1 (local) code path, so the
 * node/bun-specific operations (Bun.file, dynamic node:fs import, VACUUM INTO)
 * never execute under Cloudflare workerd. They use no static node imports,
 * matching the getLocalDb dynamic-import isolation pattern.
 */
import { sql } from 'drizzle-orm';
import type { BackupPolicy, BackupRunStatus } from '$lib/types/backup';
import type { D1Db } from './db';
import type { PcloudConfig } from './pcloud';
import {
	pcloudUploadStream,
	pcloudListFolder,
	pcloudDelete,
	pcloudStream,
	pcloudEnsureBase,
	pcloudMkcol
} from './pcloud';
import {
	getBoolSetting,
	getIntSetting,
	getSetting,
	setSetting,
	BACKUP_ENABLED_KEY,
	BACKUP_RETENTION_DAYS_KEY,
	BACKUP_LAST_BACKUP_DAY_KEY,
	BACKUP_SETTING_DEFAULTS
} from './db/dao/app-settings';
import { getForumTimezone } from './constants';

export interface BackupEntry {
	name: string;
	date: Date;
}

type AsyncTask<T> = () => Promise<T>;

/** Thrown when a backup is already running (in-process or via lockfile). */
export class BackupBusyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BackupBusyError';
	}
}

interface BackupFilePaths {
	dbPath: string;
	snapshotPath: string;
	lockPath: string;
}

/** Outcome of a detached manual-trigger attempt. */
interface BackupTriggerResult {
	/** A run was launched in the background. */
	started: boolean;
	/** Another run was already in flight (nothing started). */
	busy: boolean;
}

const BACKUP_FOLDER = '/backups';
const NAME_PREFIX = 'janbao';
// janbao-YYYYMMDD-HHMMSS.db
const NAME_PATTERN = /^janbao-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const LOCK_STALE_MS = 60 * 60 * 1000; // a held lock older than 1h is treated as abandoned

// In-process single-flight guard; shared by manual + daily triggers.
let inFlight: Promise<BackupEntry> | null = null;
// In-memory day string of the last auto-backup this process ran, to skip the
// settings read on every request after the first-of-day one.
let memLastDay: string | null = null;
// In-memory status of the most recent run (manual or daily), so the admin UI
// can poll the running → succeeded/failed transition. Lost on process restart;
// the cross-process lockfile still prevents concurrent runs in that window.
let lastStatus: BackupRunStatus | null = null;

export function isValidBackupName(name: string): boolean {
	return NAME_PATTERN.test(name);
}

/** Read the backup policy from app_settings, applying code defaults. */
export async function getBackupPolicy(db: D1Db): Promise<BackupPolicy> {
	const [enabled, retentionDays] = await Promise.all([
		getBoolSetting(db, BACKUP_ENABLED_KEY, BACKUP_SETTING_DEFAULTS.enabled),
		getIntSetting(db, BACKUP_RETENTION_DAYS_KEY, BACKUP_SETTING_DEFAULTS.retentionDays)
	]);
	return { enabled, retentionDays };
}

/** Persist the backup policy (upserts both keys). */
export async function setBackupPolicy(db: D1Db, policy: BackupPolicy): Promise<void> {
	await setSetting(db, BACKUP_ENABLED_KEY, String(policy.enabled));
	await setSetting(db, BACKUP_RETENTION_DAYS_KEY, String(policy.retentionDays));
}

/** List existing backups, newest first. Non-conforming names are ignored. */
export async function listBackups(cfg: PcloudConfig): Promise<BackupEntry[]> {
	const names = await pcloudListFolder(cfg, BACKUP_FOLDER);
	const entries: BackupEntry[] = [];
	for (const name of names) {
		const date = parseBackupDate(name);
		if (date) entries.push({ name, date });
	}
	entries.sort((a, b) => b.date.getTime() - a.date.getTime());
	return entries;
}

/** Stream a backup's bytes from pCloud for download. */
export async function downloadBackupStream(
	cfg: PcloudConfig,
	name: string
): Promise<ReadableStream<Uint8Array>> {
	if (!isValidBackupName(name)) throw new Error(`invalid backup name: ${name}`);
	const { body } = await pcloudStream(cfg, `${BACKUP_FOLDER}/${name}`);
	return body;
}

/** Delete a single backup from pCloud. */
export async function deleteBackup(cfg: PcloudConfig, name: string): Promise<void> {
	if (!isValidBackupName(name)) throw new Error(`invalid backup name: ${name}`);
	await pcloudDelete(cfg, `${BACKUP_FOLDER}/${name}`);
}

/**
 * Manually trigger a backup now, detached. Independent of `backup.enabled`;
 * retention still trims by age. Returns immediately: `{ started: true }` once
 * the run is launched in the background (its lifecycle tracked in-memory for
 * polling via `getBackupRunStatus`), or `{ busy: true }` if a run is already in
 * flight. Never throws.
 *
 * Unlike the daily path (fire-and-forget from hooks.server.ts with no caller
 * observing the result), this records an in-memory run status so the admin UI
 * can poll GET /api/admin/backups for the running → succeeded/failed transition
 * WITHOUT holding the POST request open for the entire multi-minute upload of a
 * 1GB snapshot (which would be vulnerable to proxy/browser/server timeouts).
 */
export async function startBackupDetached(
	db: D1Db,
	cfg: PcloudConfig,
	platformEnv: App.Platform['env'] | undefined
): Promise<BackupTriggerResult> {
	if (inFlight) return { started: false, busy: true };
	const tz = getForumTimezone(platformEnv);
	const policy = await getBackupPolicy(db);
	// Re-check after the async settings read - a daily run may have started.
	if (inFlight) return { started: false, busy: true };

	const startedAt = new Date().toISOString();
	markRunning(startedAt);
	// Detach the heavy work. acquireAndRun sets `inFlight` synchronously before
	// its first await, so this function's `inFlight` guards above stay sound for
	// any later request in the same tick.
	void acquireAndRun(db, cfg, tz, policy.retentionDays)
		.then((entry) => markSucceeded(startedAt, entry))
		.catch((err) => markFailed(startedAt, err));
	return { started: true, busy: false };
}

/** In-memory status of the most recent run (null until the first run). */
export function getBackupRunStatus(): BackupRunStatus | null {
	return lastStatus;
}

function markRunning(startedAt: string): void {
	lastStatus = { state: 'running', startedAt, finishedAt: null, name: null, error: null };
}

function markSucceeded(startedAt: string, entry: BackupEntry): void {
	lastStatus = {
		state: 'succeeded',
		startedAt,
		finishedAt: new Date().toISOString(),
		name: entry.name,
		error: null
	};
}

function markFailed(startedAt: string, err: unknown): void {
	lastStatus = {
		state: 'failed',
		startedAt,
		finishedAt: new Date().toISOString(),
		name: null,
		error: err instanceof Error ? err.message : String(err)
	};
	console.error('[backup] background backup failed:', err);
}

/**
 * Daily auto-backup entry point (called fire-and-forget from hooks.server.ts).
 * No-op unless backup.enabled; de-dupes within a calendar day (in-memory +
 * persistent) so only the first-of-day request actually runs it. Never throws.
 */
export async function maybeRunDailyBackup(
	db: D1Db,
	cfg: PcloudConfig,
	platformEnv: App.Platform['env'] | undefined
): Promise<void> {
	const tz = getForumTimezone(platformEnv);
	const dayKey = formatDay(new Date(), tz);
	if (memLastDay === dayKey) return;

	const policy = await getBackupPolicy(db);
	if (!policy.enabled) {
		memLastDay = dayKey; // remember the check so we don't re-read settings this day
		return;
	}

	// Claim the day persistently before running, so a concurrent first-of-day
	// request (or a process restart) can't start a second backup.
	const stored = await getSetting(db, BACKUP_LAST_BACKUP_DAY_KEY);
	if (stored === dayKey) {
		memLastDay = dayKey;
		return;
	}
	await setSetting(db, BACKUP_LAST_BACKUP_DAY_KEY, dayKey);
	memLastDay = dayKey;

	const startedAt = new Date().toISOString();
	markRunning(startedAt);
	try {
		const entry = await acquireAndRun(db, cfg, tz, policy.retentionDays);
		markSucceeded(startedAt, entry);
	} catch (err) {
		// Either busy (another process is backing up) or a genuine failure. The
		// day is already claimed, so we won't retry automatically; admin can use
		// "backup now". Keep it quiet so the request path stays unaffected.
		markFailed(startedAt, err);
	}
}

async function acquireAndRun(
	db: D1Db,
	cfg: PcloudConfig,
	tz: string,
	retentionDays: number
): Promise<BackupEntry> {
	if (inFlight) throw new BackupBusyError('a backup is already running');
	const task: AsyncTask<BackupEntry> = () =>
		withFileLock(() => performBackup(db, cfg, tz, retentionDays));
	const promise = task();
	inFlight = promise;
	try {
		return await promise;
	} finally {
		inFlight = null;
	}
}

async function performBackup(
	db: D1Db,
	cfg: PcloudConfig,
	tz: string,
	retentionDays: number
): Promise<BackupEntry> {
	const { dbPath, snapshotPath } = backupFilePaths();
	const fs = await import('node:fs/promises');
	// Clear any leftover snapshot from a crashed previous run.
	await fs.unlink(snapshotPath).catch(() => {});

	// Produce a consistent snapshot. VACUUM INTO (Online Backup) is preferred:
	// it compacts and yields a clean point-in-time copy without blocking app I/O.
	// It can fail on a database whose virtual tables can't be reconstructed on a
	// fresh connection (e.g. a contentless FTS5 table whose shadow rows are
	// inconsistent - a fresh connect then can't build the vtable to read it). In
	// that case fall back to checkpointing the WAL into the main file and copying
	// the raw bytes, which never constructs any vtable. The copy is byte-identical
	// to the live (post-checkpoint) db - a faithful restore target.
	const escaped = snapshotPath.replace(/'/g, "''");
	try {
		await db.run(sql.raw(`VACUUM INTO '${escaped}'`));
	} catch (vacuumErr) {
		console.warn('[backup] VACUUM INTO failed, using checkpoint+copy fallback:', vacuumErr);
		await db.run(sql.raw('PRAGMA wal_checkpoint(TRUNCATE)'));
		await fs.copyFile(dbPath, snapshotPath);
	}

	try {
		await pcloudEnsureBase(cfg);
		await pcloudMkcol(cfg, BACKUP_FOLDER);

		const name = `${NAME_PREFIX}-${formatBackupStamp(new Date(), tz)}.db`;
		const stream = Bun.file(snapshotPath).stream();
		await pcloudUploadStream(cfg, BACKUP_FOLDER, name, stream);

		await trimByAge(cfg, retentionDays);
		return { name, date: parseBackupDate(name) ?? new Date() };
	} finally {
		await fs.unlink(snapshotPath).catch(() => {});
	}
}

/** Delete backups older than retentionDays (by the timestamp embedded in the name). */
async function trimByAge(cfg: PcloudConfig, retentionDays: number): Promise<void> {
	const entries = await listBackups(cfg);
	const nowMs = Date.now();
	const maxAgeMs = retentionDays * DAY_MS;
	for (const entry of entries) {
		if (nowMs - entry.date.getTime() > maxAgeMs) {
			await pcloudDelete(cfg, `${BACKUP_FOLDER}/${entry.name}`).catch((err) =>
				console.error('[backup] failed to delete expired backup', entry.name, err)
			);
		}
	}
}

async function withFileLock<T>(task: AsyncTask<T>): Promise<T> {
	const { lockPath } = backupFilePaths();
	const { open, stat, unlink } = await import('node:fs/promises');
	let acquired = false;
	for (let attempt = 0; attempt < 2 && !acquired; attempt++) {
		try {
			const handle = await open(lockPath, 'wx');
			await handle.writeFile(String(process.pid));
			await handle.close();
			acquired = true;
		} catch (err) {
			const e = err as NodeJS.ErrnoException;
			if (e.code !== 'EEXIST') throw err;
			let stale: boolean;
			try {
				const s = await stat(lockPath);
				stale = Date.now() - s.mtimeMs > LOCK_STALE_MS;
			} catch {
				stale = false;
			}
			if (stale) {
				await unlink(lockPath).catch(() => {});
				continue; // retry the exclusive create
			}
			throw new BackupBusyError('backup lock held by another process');
		}
	}
	try {
		return await task();
	} finally {
		if (acquired) await unlink(lockPath).catch(() => {});
	}
}

function backupFilePaths(): BackupFilePaths {
	const dbPath = process.env.LOCAL_DB_PATH ?? '.local.db';
	return {
		dbPath,
		snapshotPath: `${dbPath}.backup-snapshot.db`,
		lockPath: `${dbPath}.backup.lock`
	};
}

/** Parse the embedded timestamp of a backup name into a Date (null if malformed). */
function parseBackupDate(name: string): Date | null {
	const match = NAME_PATTERN.exec(name);
	if (!match) return null;
	const [, year, month, day, hour, minute, second] = match;
	// The stamp is a forum-timezone wall-clock; for day-granularity retention we
	// interpret the components as UTC (off by at most the tz offset, immaterial).
	const d = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second));
	return Number.isNaN(d.getTime()) ? null : d;
}

/** YYYYMMDD-HHMMSS in the given timezone, for the backup filename. */
function formatBackupStamp(date: Date, tz: string): string {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	}).formatToParts(date);
	const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
	return `${pick('year')}${pick('month')}${pick('day')}-${pick('hour')}${pick('minute')}${pick('second')}`;
}

/** YYYY-MM-DD in the given timezone (forum-day bucket key). Mirrors joined-activity.formatDay. */
function formatDay(date: Date, tz: string): string {
	try {
		return new Intl.DateTimeFormat('en-CA', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(date);
	} catch {
		return date.toISOString().split('T')[0];
	}
}
