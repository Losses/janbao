export interface IntervalBounds {
	start: number;
	end: number;
}

/** Inclusive unix-second bounds of the interval bucket containing dateStr. */
export function getIntervalBounds(dateStr: string, interval: string): IntervalBounds {
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
