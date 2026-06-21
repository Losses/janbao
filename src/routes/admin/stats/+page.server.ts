import type { PageServerLoad } from './$types';
import { getStatsOverview, rangeToStartSec } from '$lib/server/db/dao/stats';

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
	const rangeStartSec = rangeToStartSec(range);

	const { timeline, contributors, startSec, endSec } = await getStatsOverview(
		locals.db,
		interval,
		rangeStartSec
	);

	return {
		timeline,
		initialContributors: contributors,
		interval,
		range,
		startSec,
		endSec
	};
};
