import { getOfflineDB } from './idb';

const DEFAULT_RETENTION_DAYS = 14;

// The retention window is server-configured (OFFLINE_RETENTION_DAYS) and echoed
// in each sync response; read the persisted value, falling back to the default
// before the first sync has run.
export async function getOfflineRetentionDays(): Promise<number> {
	const row = await getOfflineDB().syncMeta.get('retentionDays');
	const n = typeof row?.value === 'number' ? row.value : DEFAULT_RETENTION_DAYS;
	return n > 0 ? n : DEFAULT_RETENTION_DAYS;
}
