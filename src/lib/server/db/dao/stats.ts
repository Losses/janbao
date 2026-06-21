import { sql } from 'drizzle-orm';
import { discussions, replies, users } from '../schema';
import type { D1Db } from '../index';

export interface TimelineDataPoint {
	date: string;
	discussions: number;
	replies: number;
}

export interface ContributorTimelinePoint {
	date: string;
	count: number;
}

export interface DBStatRow {
	dateStr: string;
	count: number;
}

export interface DBContributorRaw {
	id: number;
	username: string;
	displayName: string;
	avatarFileId: string | null;
	discussionsCount: number;
	repliesCount: number;
	totalCount: number;
}

export interface DBAuthorTimelineRow {
	authorId: number;
	dateStr: string;
	count: number;
}

export interface Contributor {
	id: number;
	username: string;
	displayName: string;
	avatarFileId: string | null;
	discussionsCount: number;
	repliesCount: number;
	totalCount: number;
	timeline: ContributorTimelinePoint[];
}

export async function getTimelineStats(
	db: D1Db,
	interval: 'year' | 'month' | 'day',
	startSec?: number
): Promise<TimelineDataPoint[]> {
	const format = interval === 'year' ? '%Y' : interval === 'month' ? '%Y-%m' : '%Y-%m-%d';

	const dQuery =
		startSec !== undefined
			? sql`
			SELECT 
				strftime(${format}, datetime(created_at, 'unixepoch')) AS dateStr, 
				COUNT(*) AS count 
			FROM ${discussions} 
			WHERE deleted_at IS NULL AND created_at >= ${startSec}
			GROUP BY 1
		`
			: sql`
			SELECT 
				strftime(${format}, datetime(created_at, 'unixepoch')) AS dateStr, 
				COUNT(*) AS count 
			FROM ${discussions} 
			WHERE deleted_at IS NULL 
			GROUP BY 1
		`;

	const rQuery =
		startSec !== undefined
			? sql`
			SELECT 
				strftime(${format}, datetime(created_at, 'unixepoch')) AS dateStr, 
				COUNT(*) AS count 
			FROM ${replies} 
			WHERE deleted_at IS NULL AND created_at >= ${startSec}
			GROUP BY 1
		`
			: sql`
			SELECT 
				strftime(${format}, datetime(created_at, 'unixepoch')) AS dateStr, 
				COUNT(*) AS count 
			FROM ${replies} 
			WHERE deleted_at IS NULL 
			GROUP BY 1
		`;

	const [dRows, rRows] = await Promise.all([db.all<DBStatRow>(dQuery), db.all<DBStatRow>(rQuery)]);

	return fillTimeline(dRows, rRows, interval);
}

export async function getContributorsStats(
	db: D1Db,
	interval: 'year' | 'month' | 'day',
	startSec: number,
	endSec: number
): Promise<Contributor[]> {
	// 1. Get Top 20 contributors in the range
	const topQuery = sql`
		SELECT 
			u.id AS id, 
			u.username AS username, 
			u.display_name AS displayName, 
			u.avatar_file_id AS avatarFileId,
			COALESCE(d_count.cnt, 0) AS discussionsCount,
			COALESCE(r_count.cnt, 0) AS repliesCount,
			(COALESCE(d_count.cnt, 0) + COALESCE(r_count.cnt, 0)) AS totalCount
		FROM ${users} u
		LEFT JOIN (
			SELECT author_id, COUNT(*) AS cnt 
			FROM ${discussions} 
			WHERE deleted_at IS NULL AND created_at >= ${startSec} AND created_at <= ${endSec}
			GROUP BY author_id
		) d_count ON u.id = d_count.author_id
		LEFT JOIN (
			SELECT author_id, COUNT(*) AS cnt 
			FROM ${replies} 
			WHERE deleted_at IS NULL AND created_at >= ${startSec} AND created_at <= ${endSec}
			GROUP BY author_id
		) r_count ON u.id = r_count.author_id
		WHERE (COALESCE(d_count.cnt, 0) + COALESCE(r_count.cnt, 0)) > 0
		ORDER BY totalCount DESC
		LIMIT 20
	`;

	const contributorsRaw = await db.all<DBContributorRaw>(topQuery);
	if (contributorsRaw.length === 0) {
		return [];
	}

	const authorIds = contributorsRaw.map((c) => c.id);

	// 2. Query individual timelines for these top 20
	const format = interval === 'year' ? '%Y' : interval === 'month' ? '%Y-%m' : '%Y-%m-%d';

	const dTimelineQuery = sql`
		SELECT 
			author_id AS authorId,
			strftime(${format}, datetime(created_at, 'unixepoch')) AS dateStr,
			COUNT(*) AS count
		FROM ${discussions}
		WHERE deleted_at IS NULL 
			AND created_at >= ${startSec} 
			AND created_at <= ${endSec} 
			AND author_id IN (${sql.raw(authorIds.join(','))})
		GROUP BY 1, 2
	`;

	const rTimelineQuery = sql`
		SELECT 
			author_id AS authorId,
			strftime(${format}, datetime(created_at, 'unixepoch')) AS dateStr,
			COUNT(*) AS count
		FROM ${replies}
		WHERE deleted_at IS NULL 
			AND created_at >= ${startSec} 
			AND created_at <= ${endSec} 
			AND author_id IN (${sql.raw(authorIds.join(','))})
		GROUP BY 1, 2
	`;

	const [dTimeline, rTimeline] = await Promise.all([
		db.all<DBAuthorTimelineRow>(dTimelineQuery),
		db.all<DBAuthorTimelineRow>(rTimelineQuery)
	]);

	// Generate list of all date strings in range
	const dateKeys = generateDateKeys(startSec, endSec, interval);

	// Map timelines by author and dateStr
	const contributionMap: Record<number, Record<string, number>> = {};
	for (const id of authorIds) {
		contributionMap[id] = {};
		for (const key of dateKeys) {
			contributionMap[id][key] = 0;
		}
	}

	for (const row of dTimeline) {
		if (contributionMap[row.authorId] && row.dateStr in contributionMap[row.authorId]) {
			contributionMap[row.authorId][row.dateStr] += row.count;
		}
	}

	for (const row of rTimeline) {
		if (contributionMap[row.authorId] && row.dateStr in contributionMap[row.authorId]) {
			contributionMap[row.authorId][row.dateStr] += row.count;
		}
	}

	// Map back to contributors array
	return contributorsRaw.map((c) => {
		const timeline = dateKeys.map((key) => ({
			date: key,
			count: contributionMap[c.id]?.[key] ?? 0
		}));
		return {
			id: Number(c.id),
			username: String(c.username),
			displayName: String(c.displayName),
			avatarFileId: c.avatarFileId ? String(c.avatarFileId) : null,
			discussionsCount: Number(c.discussionsCount),
			repliesCount: Number(c.repliesCount),
			totalCount: Number(c.totalCount),
			timeline
		};
	});
}

function fillTimeline(
	discussionsRows: DBStatRow[],
	repliesRows: DBStatRow[],
	interval: 'year' | 'month' | 'day'
): TimelineDataPoint[] {
	const map: Record<string, TimelineDataPoint> = {};
	let minDateStr = '';
	let maxDateStr = '';

	for (const row of discussionsRows) {
		if (!row.dateStr) continue;
		if (!minDateStr || row.dateStr < minDateStr) minDateStr = row.dateStr;
		if (!maxDateStr || row.dateStr > maxDateStr) maxDateStr = row.dateStr;
		map[row.dateStr] = { date: row.dateStr, discussions: row.count, replies: 0 };
	}

	for (const row of repliesRows) {
		if (!row.dateStr) continue;
		if (!minDateStr || row.dateStr < minDateStr) minDateStr = row.dateStr;
		if (!maxDateStr || row.dateStr > maxDateStr) maxDateStr = row.dateStr;
		if (map[row.dateStr]) {
			map[row.dateStr].replies = row.count;
		} else {
			map[row.dateStr] = { date: row.dateStr, discussions: 0, replies: row.count };
		}
	}

	if (!minDateStr || !maxDateStr) {
		return [];
	}

	const result: TimelineDataPoint[] = [];
	if (interval === 'day') {
		const start = new Date(minDateStr);
		const end = new Date(maxDateStr);
		for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
			const yyyy = d.getFullYear();
			const mm = String(d.getMonth() + 1).padStart(2, '0');
			const dd = String(d.getDate()).padStart(2, '0');
			const key = `${yyyy}-${mm}-${dd}`;
			const val = map[key] || { date: key, discussions: 0, replies: 0 };
			result.push(val);
		}
	} else if (interval === 'month') {
		const [startY, startM] = minDateStr.split('-').map(Number);
		const [endY, endM] = maxDateStr.split('-').map(Number);
		let y = startY;
		let m = startM;
		while (y < endY || (y === endY && m <= endM)) {
			const key = `${y}-${String(m).padStart(2, '0')}`;
			const val = map[key] || { date: key, discussions: 0, replies: 0 };
			result.push(val);
			m++;
			if (m > 12) {
				m = 1;
				y++;
			}
		}
	} else {
		const startY = Number(minDateStr);
		const endY = Number(maxDateStr);
		for (let y = startY; y <= endY; y++) {
			const key = String(y);
			const val = map[key] || { date: key, discussions: 0, replies: 0 };
			result.push(val);
		}
	}

	return result;
}

function generateDateKeys(
	startSec: number,
	endSec: number,
	interval: 'year' | 'month' | 'day'
): string[] {
	const start = new Date(startSec * 1000);
	const end = new Date(endSec * 1000);

	const keys: string[] = [];

	if (interval === 'day') {
		for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
			const yyyy = d.getFullYear();
			const mm = String(d.getMonth() + 1).padStart(2, '0');
			const dd = String(d.getDate()).padStart(2, '0');
			keys.push(`${yyyy}-${mm}-${dd}`);
		}
	} else if (interval === 'month') {
		const startY = start.getFullYear();
		const startM = start.getMonth() + 1;
		const endY = end.getFullYear();
		const endM = end.getMonth() + 1;
		let y = startY;
		let m = startM;
		while (y < endY || (y === endY && m <= endM)) {
			keys.push(`${y}-${String(m).padStart(2, '0')}`);
			m++;
			if (m > 12) {
				m = 1;
				y++;
			}
		}
	} else {
		const startY = start.getFullYear();
		const endY = end.getFullYear();
		for (let y = startY; y <= endY; y++) {
			keys.push(String(y));
		}
	}

	return keys;
}
