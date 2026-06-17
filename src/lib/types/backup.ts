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
