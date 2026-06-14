import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/errors';
import { ensureFtsSchema, rebuildFtsTable } from '$lib/server/search/fts-schema';
import {
	findBackfillTask,
	getBackfillTasks,
	getBackfillStartCursor,
	backfillTableStep
} from '$lib/server/search/backfill';
import type { RequestHandler } from './$types';

interface BackfillRequestBody {
	table?: string;
	cursor?: number | null;
}

interface BackfillResponseBody {
	table: string;
	indexed: number;
	cursor: number | null;
	done: boolean;
	nextTable: string | null;
}

// POST /admin/backfill-fts — populate the FTS5 index in the Worker runtime.
//
// Production can't run the bun CLI (no shell), and a Worker has a wall-time
// budget, so the caller drives this in a loop: each call processes one batch of
// one table and returns a cursor (or the next table once this one is exhausted).
// The table is cleared when a table is (re)started with no cursor, so the whole
// run is idempotent. Admin only.
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	const t = locals.t;
	if (!user || user.groupSlug !== 'admin') {
		return jsonError(t, 'common.forbidden', 403);
	}

	const body = (await request.json()) as BackfillRequestBody;
	const db = locals.db;
	await ensureFtsSchema(db);

	const tasks = getBackfillTasks();
	const task = body.table ? findBackfillTask(body.table) : tasks[0];
	if (!task) {
		return jsonError(t, 'common.badRequest', 400);
	}

	const isStart = body.cursor === undefined || body.cursor === null;
	// When not starting fresh, body.cursor is guaranteed non-null by isStart above;
	// the ?? 0 satisfies the type without changing behavior.
	const cursor = isStart ? await getBackfillStartCursor(db, task) : (body.cursor ?? 0);
	if (isStart) {
		await rebuildFtsTable(db, task.ftsTable);
	}

	const result = await backfillTableStep(db, task, cursor);

	let nextTable: string | null = null;
	if (result.nextCursor === null) {
		const idx = tasks.findIndex((tk) => tk.table === task.table);
		nextTable = idx >= 0 && idx + 1 < tasks.length ? (tasks[idx + 1]?.table ?? null) : null;
	}

	const response: BackfillResponseBody = {
		table: task.table,
		indexed: result.indexed,
		cursor: result.nextCursor,
		done: result.nextCursor === null,
		nextTable
	};
	return json(response);
};
