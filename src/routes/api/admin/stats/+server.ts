import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/admin';
import { getTimelineStats, getContributorsStats, rangeToStartSec } from '$lib/server/db/dao/stats';

export const GET: RequestHandler = async ({ url, locals }) => {
	const authError = requireAdmin(locals.user, locals.t);
	if (authError) return authError;

	const interval = (url.searchParams.get('interval') || 'day') as 'year' | 'month' | 'day';
	if (interval !== 'year' && interval !== 'month' && interval !== 'day') {
		return json({ error: 'Invalid interval' }, { status: 400 });
	}

	const startStr = url.searchParams.get('start');
	const endStr = url.searchParams.get('end');

	if (startStr && endStr) {
		const startSec = Number(startStr);
		const endSec = Number(endStr);
		if (Number.isNaN(startSec) || Number.isNaN(endSec)) {
			return json({ error: 'Invalid start or end time' }, { status: 400 });
		}
		const contributors = await getContributorsStats(locals.db, interval, startSec, endSec);
		return json({ contributors });
	} else {
		const range = url.searchParams.get('range') || 'all';
		const timeline = await getTimelineStats(locals.db, interval, rangeToStartSec(range));
		return json({ timeline });
	}
};
