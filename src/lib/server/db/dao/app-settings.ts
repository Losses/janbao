/**
 * Generic key-value application settings store (VS Code-style dotted keys).
 *
 * Defaults live in code, not in the table: a missing key resolves to the
 * caller-supplied fallback (or the BACKUP_SETTING_DEFAULTS map for backup).
 * First consumer is the daily-DB-backup feature, but the store is intentionally
 * domain-agnostic so future settings reuse it.
 */
import { appSettings } from '../schema';
import { eq, like } from 'drizzle-orm';
import type { D1Db } from '../index';
import type { BackupPolicy } from '$lib/types/backup';

// --- Backup domain keys & defaults ---------------------------------------
export const BACKUP_ENABLED_KEY = 'backup.enabled';
export const BACKUP_RETENTION_DAYS_KEY = 'backup.retentionDays';
// Runtime-only: the forum-timezone day string of the last auto backup. Written
// before a backup runs (to claim the day against concurrent first-of-day
// requests), so it gates dedup across process restarts.
export const BACKUP_LAST_BACKUP_DAY_KEY = 'backup.lastBackupDay';

// The default policy doubles as the BackupPolicy shape (enabled + retentionDays),
// so the same type backs the code defaults and the read/write API.
export const BACKUP_SETTING_DEFAULTS: BackupPolicy = {
	enabled: false,
	retentionDays: 30
};

/** Read a single setting's raw string value, or null when the key is unset. */
export async function getSetting(db: D1Db, key: string): Promise<string | null> {
	const rows = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
	return rows.length > 0 ? rows[0].value : null;
}

/** Upsert a setting (string value), bumping updatedAt on conflict. */
export async function setSetting(db: D1Db, key: string, value: string): Promise<void> {
	await db
		.insert(appSettings)
		.values({ key, value, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: appSettings.key,
			set: { value, updatedAt: new Date() }
		});
}

/** Read a boolean setting; falls back when unset or unparseable. */
export async function getBoolSetting(db: D1Db, key: string, fallback: boolean): Promise<boolean> {
	const raw = await getSetting(db, key);
	if (raw === null) return fallback;
	return raw === 'true' || raw === '1';
}

/** Read an integer setting; falls back when unset, non-numeric, or non-positive. */
export async function getIntSetting(db: D1Db, key: string, fallback: number): Promise<number> {
	const raw = await getSetting(db, key);
	if (raw === null) return fallback;
	const parsed = parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Load all settings whose key starts with `prefix` (e.g. "backup."). */
export async function listSettingsByPrefix(
	db: D1Db,
	prefix: string
): Promise<Record<string, string>> {
	const rows = await db
		.select({ key: appSettings.key, value: appSettings.value })
		.from(appSettings)
		.where(like(appSettings.key, `${prefix}%`));
	const out: Record<string, string> = {};
	for (const row of rows) out[row.key] = row.value;
	return out;
}
