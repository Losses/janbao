import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { resolvePcloudConfig, pcloudIsConfigured } from '$lib/server/pcloud';
import { getBackupPolicy, listBackups } from '$lib/server/backup';
import { BACKUP_SETTING_DEFAULTS } from '$lib/server/db/dao/app-settings';
import type { BackupListItem } from '$lib/types/backup';

export const load: PageServerLoad = async ({ locals, platform }) => {
	// Backups are a local node/bun feature: the local SQLite file is the only
	// thing that can be snapshotted to a file. In Cloudflare (D1) there is no
	// file to back up this way.
	const available = !platform?.env?.D1_DB;

	const cfg = resolvePcloudConfig({ ...env, ...(platform?.env ?? {}) });
	const policy = await getBackupPolicy(locals.db);

	let backups: BackupListItem[] = [];
	if (available && pcloudIsConfigured(cfg)) {
		const entries = await listBackups(cfg);
		backups = entries.map((entry) => ({ name: entry.name, date: entry.date.toISOString() }));
	}

	return {
		available: available && pcloudIsConfigured(cfg),
		pcloudConfigured: pcloudIsConfigured(cfg),
		policy,
		backups,
		retentionDaysDefault: BACKUP_SETTING_DEFAULTS.retentionDays
	};
};
