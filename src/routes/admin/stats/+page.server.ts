import type { PageServerLoad } from './$types';
import { getTimelineStats, getContributorsStats } from '$lib/server/db/dao/stats';
import type { Contributor } from '$lib/server/db/dao/stats';

export interface IntervalBounds {
	start: number;
	end: number;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const interval = (url.searchParams.get('interval') || 'month') as 'year' | 'month' | 'day';
	if (interval !== 'year' && interval !== 'month' && interval !== 'day') {
		return {
			timeline: [],
			initialContributors: [],
			interval: 'month',
			range: 'all',
			startSec: 0,
			endSec: 0
		};
	}

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

	let initialContributors: Contributor[] = [];
	let startSec = 0;
	let endSec = Math.floor(Date.now() / 1000);

	if (timeline.length > 0) {
		const firstPoint = timeline[0];
		const lastPoint = timeline[timeline.length - 1];

		const firstBounds = getIntervalBounds(firstPoint.date, interval);
		const lastBounds = getIntervalBounds(lastPoint.date, interval);

		startSec = firstBounds.start;
		endSec = lastBounds.end;

		initialContributors = await getContributorsStats(locals.db, interval, startSec, endSec);
	}

	return {
		timeline,
		initialContributors,
		interval,
		range,
		startSec,
		endSec
	};
};

function getIntervalBounds(dateStr: string, interval: 'year' | 'month' | 'day'): IntervalBounds {
	if (interval === 'day') {
		const start = Math.floor(Date.parse(dateStr + 'T00:00:00Z') / 1000);
		const end = Math.floor(Date.parse(dateStr + 'T23:59:59Z') / 1000);
		return { start, end };
	} else if (interval === 'month') {
		const [y, m] = dateStr.split('-').map(Number);
		const start = Math.floor(Date.UTC(y, m - 1, 1) / 1000);
		const end = Math.floor(Date.UTC(y, m, 1) / 1000) - 1;
		return { start, end };
	} else {
		const y = Number(dateStr);
		const start = Math.floor(Date.UTC(y, 0, 1) / 1000);
		const end = Math.floor(Date.UTC(y + 1, 0, 1) / 1000) - 1;
		return { start, end };
	}
}
