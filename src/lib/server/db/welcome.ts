/**
 * Resolve the UTC offset (in minutes) of `referenceDate` as observed in `tz`.
 * Falls back to 0 (UTC) when the timezone is invalid.
 */
function getTzOffsetMinutes(referenceDate: Date, tz: string): number {
	try {
		const offsetParts = new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			timeZoneName: 'longOffset'
		}).formatToParts(referenceDate);
		const offsetStr = offsetParts.find((p) => p.type === 'timeZoneName')?.value || 'GMT';

		const match = offsetStr.match(/GMT([+-])(\d+)(?::(\d+))?/);
		if (match) {
			const sign = match[1] === '+' ? 1 : -1;
			const hours = parseInt(match[2], 10);
			const minutes = match[3] ? parseInt(match[3], 10) : 0;
			return sign * (hours * 60 + minutes);
		}
	} catch (err) {
		console.error(`Invalid timezone "${tz}", falling back to UTC offsets.`, err);
	}
	return 0;
}

/**
 * A UTC Date boundary window { start, end }. The inclusivity of `end` is
 * producer-specific - see the producing function's JSDoc. Callers must pair a
 * boundary with the comparator matching its producer (inclusive → `lte`,
 * half-open → `lt`).
 */
export interface DateBoundary {
	start: Date;
	end: Date;
}

/**
 * Resolve the UTC Date boundaries of the current calendar month in the given
 * timezone. Returns a **half-open** window `[start, end)` where `end` is the
 * first instant of the next month - pair with `lt(column, end)`. Used to
 * evaluate monthly invitation-request limits per RQ00-Backend §6.4.
 */
export function getTzMonthBoundaries(tz: string): DateBoundary {
	const now = new Date();
	let year: number;
	let month: number;
	try {
		const parts = new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit'
		}).formatToParts(now);
		year = parseInt(parts.find((p) => p.type === 'year')?.value || '', 10);
		month = parseInt(parts.find((p) => p.type === 'month')?.value || '', 10) - 1;
		if (isNaN(year) || isNaN(month)) throw new Error('invalid month resolution');
	} catch (err) {
		console.error(`Invalid timezone "${tz}", falling back to UTC month.`, err);
		year = now.getUTCFullYear();
		month = now.getUTCMonth();
	}

	const startOffset = getTzOffsetMinutes(new Date(Date.UTC(year, month, 1, 0, 0, 0)), tz);
	const startMs = Date.UTC(year, month, 1, 0, 0, 0) - startOffset * 60 * 1000;

	const nextMonth = month === 11 ? 0 : month + 1;
	const nextYear = month === 11 ? year + 1 : year;
	const endOffset = getTzOffsetMinutes(new Date(Date.UTC(nextYear, nextMonth, 1, 0, 0, 0)), tz);
	const endMs = Date.UTC(nextYear, nextMonth, 1, 0, 0, 0) - endOffset * 60 * 1000;

	return { start: new Date(startMs), end: new Date(endMs) };
}
