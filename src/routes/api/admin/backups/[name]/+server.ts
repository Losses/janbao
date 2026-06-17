import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { jsonError } from '$lib/server/errors';
import { requireAdmin } from '$lib/server/admin';
import { resolvePcloudConfig, pcloudIsConfigured } from '$lib/server/pcloud';
import { downloadBackupStream, deleteBackup, isValidBackupName } from '$lib/server/backup';

// [name] is constrained to the janbao-YYYYMMDD-HHMMSS.db pattern (checked before
// any pCloud path is built), so there is no path-traversal surface into /backups.

export const GET: RequestHandler = async ({ locals, platform, params }) => {
	const authError = requireAdmin(locals.user, locals.t);
	if (authError) return authError;

	const name = params.name ?? '';
	if (!isValidBackupName(name)) return jsonError(locals.t, 'backup.notFound', 404);

	const cfg = resolvePcloudConfig({ ...env, ...(platform?.env ?? {}) });
	if (!pcloudIsConfigured(cfg)) return jsonError(locals.t, 'backup.notAvailable', 400);

	try {
		const stream = await downloadBackupStream(cfg, name);
		return new Response(stream, {
			headers: {
				'Content-Type': 'application/octet-stream',
				'Content-Disposition': `attachment; filename="${name}"`
			}
		});
	} catch (err) {
		console.error('[backup] download failed:', err);
		return jsonError(locals.t, 'backup.notFound', 404);
	}
};

export const DELETE: RequestHandler = async ({ locals, platform, params }) => {
	const authError = requireAdmin(locals.user, locals.t);
	if (authError) return authError;

	const name = params.name ?? '';
	if (!isValidBackupName(name)) return jsonError(locals.t, 'backup.notFound', 404);

	const cfg = resolvePcloudConfig({ ...env, ...(platform?.env ?? {}) });
	if (!pcloudIsConfigured(cfg)) return jsonError(locals.t, 'backup.notAvailable', 400);

	try {
		await deleteBackup(cfg, name);
		return json({ success: true });
	} catch (err) {
		console.error('[backup] delete failed:', err);
		return jsonError(locals.t, 'backup.deleteFailed', 500);
	}
};
