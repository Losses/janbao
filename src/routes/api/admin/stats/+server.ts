import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/admin';
import { getTimelineStats, getContributorsStats } from '$lib/server/db/dao/stats';

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
		let rangeStartSec: number | undefined;
		const now = new Date();
		const y = now.getUTCFullYear();
		const m = now.getUTCMonth();
		const d = now.getUTCDate();
		switch (range) {
			case '2y':
				rangeStartSec = Math.floor(Date.UTC(y - 2, m, d) / 1000);
				break;
			case '1y':
				rangeStartSec = Math.floor(Date.UTC(y - 1, m, d) / 1000);
				break;
			case '6m':
				rangeStartSec = Math.floor(Date.UTC(y, m - 6, d) / 1000);
				break;
			case '3m':
				rangeStartSec = Math.floor(Date.UTC(y, m - 3, d) / 1000);
				break;
			case 'current_month':
				rangeStartSec = Math.floor(Date.UTC(y, m, 1) / 1000);
				break;
			case 'all':
			default:
				rangeStartSec = undefined;
				break;
		}
		const timeline = await getTimelineStats(locals.db, interval, rangeStartSec);
		return json({ timeline });
	}
};
