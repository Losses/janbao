import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { jsonError } from '$lib/server/errors';
import { requireAdmin } from '$lib/server/admin';
import { resolvePcloudConfig, pcloudIsConfigured } from '$lib/server/pcloud';
import {
	getBackupPolicy,
	setBackupPolicy,
	listBackups,
	runBackupNow,
	BackupBusyError
} from '$lib/server/backup';
import { BACKUP_SETTING_DEFAULTS } from '$lib/server/db/dao/app-settings';
import type { BackupPolicy } from '$lib/types/backup';

// The feature only operates in local node/bun mode (where LOCAL_DB_PATH is a real
// file VACUUM INTO can snapshot) with pCloud configured. Returns the cfg + a
// combined availability flag so handlers share one resolution path.
interface ResolvedBackupEnv {
	cfg: ReturnType<typeof resolvePcloudConfig>;
	available: boolean;
}

function resolveBackupEnv(platform: App.Platform | undefined): ResolvedBackupEnv {
	const cfg = resolvePcloudConfig({ ...env, ...(platform?.env ?? {}) });
	return { cfg, available: !platform?.env?.D1_DB && pcloudIsConfigured(cfg) };
}

export const GET: RequestHandler = async ({ locals, platform }) => {
	const authError = requireAdmin(locals.user, locals.t);
	if (authError) return authError;

	const { cfg, available } = resolveBackupEnv(platform);
	const policy = await getBackupPolicy(locals.db);
	const backups = available
		? (await listBackups(cfg)).map((entry) => ({
				name: entry.name,
				date: entry.date.toISOString()
			}))
		: [];
	return json({ available, policy, backups });
};

export const POST: RequestHandler = async ({ locals, platform }) => {
	const authError = requireAdmin(locals.user, locals.t);
	if (authError) return authError;

	const { cfg, available } = resolveBackupEnv(platform);
	if (!available) return jsonError(locals.t, 'backup.notAvailable', 400);

	try {
		const entry = await runBackupNow(locals.db, cfg, platform?.env);
		return json({
			success: true,
			backup: { name: entry.name, date: entry.date.toISOString() }
		});
	} catch (err) {
		if (err instanceof BackupBusyError) return jsonError(locals.t, 'backup.backupInProgress', 409);
		console.error('[backup] manual backup failed:', err);
		return jsonError(locals.t, 'backup.backupFailed', 500);
	}
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	const authError = requireAdmin(locals.user, locals.t);
	if (authError) return authError;

	const body = (await request.json()) as Partial<BackupPolicy>;
	const enabled = body.enabled === true;
	const parsedRetention = Math.floor(Number(body.retentionDays));
	const retentionDays =
		Number.isFinite(parsedRetention) && parsedRetention > 0
			? parsedRetention
			: BACKUP_SETTING_DEFAULTS.retentionDays;

	await setBackupPolicy(locals.db, { enabled, retentionDays });
	return json({ success: true });
};
