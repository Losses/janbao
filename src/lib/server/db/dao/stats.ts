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

export interface IntervalBounds {
	start: number;
	end: number;
}

export interface StatsOverview {
	timeline: TimelineDataPoint[];
	contributors: Contributor[];
	startSec: number;
	endSec: number;
}

interface UserLookupRow {
	id: number;
	username: string;
	displayName: string;
	avatarFileId: string | null;
}

interface AuthorAggregate {
	discussionsCount: number;
	repliesCount: number;
	monthly: Map<string, number>;
}

interface RankedAuthor {
	id: number;
	aggregate: AuthorAggregate;
	total: number;
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

/**
 * Convert a stats range selector into a unix-seconds lower bound.
 * 'all' (and any unrecognized value) returns undefined = unbounded.
 */
export function rangeToStartSec(range: string): number | undefined {
	const now = new Date();
	const y = now.getUTCFullYear();
	const m = now.getUTCMonth();
	const d = now.getUTCDate();
	switch (range) {
		case '2y':
			return Math.floor(Date.UTC(y - 2, m, d) / 1000);
		case '1y':
			return Math.floor(Date.UTC(y - 1, m, d) / 1000);
		case '6m':
			return Math.floor(Date.UTC(y, m - 6, d) / 1000);
		case '3m':
			return Math.floor(Date.UTC(y, m - 3, d) / 1000);
		case 'current_month':
			return Math.floor(Date.UTC(y, m, 1) / 1000);
		case 'all':
		default:
			return undefined;
	}
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

function mapToStatRows(counts: Map<string, number>): DBStatRow[] {
	return [...counts.entries()].map(([dateStr, count]) => ({ dateStr, count }));
}

/**
 * Single-pass admin overview: timeline + top-20 contributors and their
 * per-interval timelines, derived from one grouped scan per table.
 *
 * Replaces the previous 3-round flow (timeline -> top -> contributor timeline)
 * which scanned the replies table three times for the default range=all view.
 * rangeStartSec ?? 0 keeps a single query shape; created_at >= 0 matches every
 * row while still letting the planner use the created_at index.
 */
export async function getStatsOverview(
	db: D1Db,
	interval: 'year' | 'month' | 'day',
	rangeStartSec?: number
): Promise<StatsOverview> {
	const format = interval === 'year' ? '%Y' : interval === 'month' ? '%Y-%m' : '%Y-%m-%d';
	const lowerBound = rangeStartSec ?? 0;

	const discussionsQuery = sql`
		SELECT
			author_id AS authorId,
			strftime(${format}, datetime(created_at, 'unixepoch')) AS dateStr,
			COUNT(*) AS count
		FROM ${discussions}
		WHERE deleted_at IS NULL AND created_at >= ${lowerBound}
		GROUP BY author_id, dateStr
	`;

	const repliesQuery = sql`
		SELECT
			author_id AS authorId,
			strftime(${format}, datetime(created_at, 'unixepoch')) AS dateStr,
			COUNT(*) AS count
		FROM ${replies}
		WHERE deleted_at IS NULL AND created_at >= ${lowerBound}
		GROUP BY author_id, dateStr
	`;

	const [dRows, rRows] = await Promise.all([
		db.all<DBAuthorTimelineRow>(discussionsQuery),
		db.all<DBAuthorTimelineRow>(repliesQuery)
	]);

	const discussionsByDate = new Map<string, number>();
	const repliesByDate = new Map<string, number>();
	const authors = new Map<number, AuthorAggregate>();
	const ensureAuthor = (id: number): AuthorAggregate => {
		let aggregate = authors.get(id);
		if (!aggregate) {
			aggregate = { discussionsCount: 0, repliesCount: 0, monthly: new Map() };
			authors.set(id, aggregate);
		}
		return aggregate;
	};

	for (const row of dRows) {
		const count = Number(row.count);
		discussionsByDate.set(row.dateStr, (discussionsByDate.get(row.dateStr) ?? 0) + count);
		const aggregate = ensureAuthor(Number(row.authorId));
		aggregate.discussionsCount += count;
		aggregate.monthly.set(row.dateStr, (aggregate.monthly.get(row.dateStr) ?? 0) + count);
	}
	for (const row of rRows) {
		const count = Number(row.count);
		repliesByDate.set(row.dateStr, (repliesByDate.get(row.dateStr) ?? 0) + count);
		const aggregate = ensureAuthor(Number(row.authorId));
		aggregate.repliesCount += count;
		aggregate.monthly.set(row.dateStr, (aggregate.monthly.get(row.dateStr) ?? 0) + count);
	}

	const timeline = fillTimeline(
		mapToStatRows(discussionsByDate),
		mapToStatRows(repliesByDate),
		interval
	);

	if (timeline.length === 0) {
		return { timeline: [], contributors: [], startSec: 0, endSec: 0 };
	}

	const startSec = getIntervalBounds(timeline[0].date, interval).start;
	const endSec = getIntervalBounds(timeline[timeline.length - 1].date, interval).end;
	const dateKeys = generateDateKeys(startSec, endSec, interval);

	const ranked: RankedAuthor[] = [...authors.entries()]
		.map(([id, aggregate]) => ({
			id,
			aggregate,
			total: aggregate.discussionsCount + aggregate.repliesCount
		}))
		.sort((a, b) => b.total - a.total)
		.slice(0, 20);

	const userRows =
		ranked.length > 0
			? await db.all<UserLookupRow>(sql`
					SELECT id, username, display_name AS displayName, avatar_file_id AS avatarFileId
					FROM ${users}
					WHERE id IN (${sql.raw(ranked.map((r) => r.id).join(','))})
				`)
			: [];
	const userById = new Map<number, UserLookupRow>(userRows.map((u) => [Number(u.id), u]));

	const contributors: Contributor[] = ranked.map(({ id, aggregate, total }) => {
		const user = userById.get(id);
		return {
			id,
			username: String(user?.username ?? ''),
			displayName: String(user?.displayName ?? ''),
			avatarFileId: user?.avatarFileId ? String(user.avatarFileId) : null,
			discussionsCount: aggregate.discussionsCount,
			repliesCount: aggregate.repliesCount,
			totalCount: total,
			timeline: dateKeys.map((key) => ({ date: key, count: aggregate.monthly.get(key) ?? 0 }))
		};
	});

	return { timeline, contributors, startSec, endSec };
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
