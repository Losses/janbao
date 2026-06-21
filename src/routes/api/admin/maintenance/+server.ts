import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import { requireAdmin } from '$lib/server/admin';
import {
	getMaintenanceOverview,
	isOpAvailable,
	MAINTENANCE_OPS,
	runMaintenanceAndRecord,
	startMaintenanceDetached
} from '$lib/server/maintenance';
import type { MaintenanceOp } from '$lib/types/maintenance';
import type { RequestHandler } from './$types';

// POST body shape for triggering one maintenance op. Named (not inline) per the
// no-inline-typing rule.
interface MaintenanceRequestBody {
	op: MaintenanceOp;
}

function parseOp(raw: unknown): MaintenanceOp | null {
	if (typeof raw !== 'string') return null;
	return (MAINTENANCE_OPS as readonly string[]).includes(raw) ? (raw as MaintenanceOp) : null;
}

// GET /api/admin/maintenance - per-op availability + last-run timestamps (from
// the app_settings KV store) and the in-flight detached-run status for polling.
export const GET: RequestHandler = async ({ locals, platform }) => {
	const authError = requireAdmin(locals.user, locals.t);
	if (authError) return authError;

	const overview = await getMaintenanceOverview(locals.db, platform);
	return json(overview);
};

// POST /api/admin/maintenance { op } - run one op. ANALYZE is fast and runs
// synchronously (available on local + D1); integrity_check / fts_rebuild launch
// detached and are polled via GET (local only). 409 if a detached run is busy.
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const authError = requireAdmin(locals.user, locals.t);
	if (authError) return authError;

	const body = (await request.json()) as MaintenanceRequestBody;
	const op = parseOp(body.op);
	if (!op) return jsonError(locals.t, 'common.badRequest', 400);
	if (!isOpAvailable(op, platform)) {
		return jsonError(locals.t, 'maintenance.notAvailable', 400);
	}

	if (op === 'analyze') {
		const result = await runMaintenanceAndRecord(locals.db, op);
		if (!result.ok) return jsonError(locals.t, 'common.internalError', 500);
		return json({ success: true, result: result.result ?? null });
	}

	const trigger = await startMaintenanceDetached(locals.db, op);
	if (trigger.busy) return jsonError(locals.t, 'maintenance.inProgress', 409);
	return json({ success: true, started: true });
};
