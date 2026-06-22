import { sql } from 'drizzle-orm';
import { contributionBucketStats, discussions, replies, users } from '../schema';
import type { D1Db, DbTransaction } from '../index';
import { getIntervalBounds } from '$lib/utils/date';

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


function mapToStatRows(counts: Map<string, number>): DBStatRow[] {
	return [...counts.entries()].map(([dateStr, count]) => ({ dateStr, count }));
}

// --- Materialized contribution_bucket_stats -------------------------------
// Frozen per-author-per-month counts. Past months are immutable (created_at
// never moves a row across buckets), so each is computed once and only the
// current month is read live from replies/discussions. bucket_type leads the
// PK so reads filter `WHERE bucket_type='month'` as a prefix scan; only 'month'
// is populated today (week/quarter can be added later without a schema change).

const CONTRIBUTION_BUCKET_DDL =
	'CREATE TABLE IF NOT EXISTS contribution_bucket_stats (' +
	"bucket_type TEXT NOT NULL DEFAULT 'month', " +
	'author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, ' +
	'bucket TEXT NOT NULL, ' +
	'reply_count INTEGER NOT NULL DEFAULT 0, ' +
	'discussion_count INTEGER NOT NULL DEFAULT 0, ' +
	'PRIMARY KEY (bucket_type, author_id, bucket))';

/** Create contribution_bucket_stats if missing (idempotent). Mirrors ensureFtsSchema. */
export async function ensureContributionStatsSchema(db: D1Db): Promise<void> {
	await db.run(sql.raw(CONTRIBUTION_BUCKET_DDL));
}

interface RebuildCounts {
	replies: number;
	discussions: number;
	buckets: number;
}

interface CountRow {
	total: number | null;
}

interface BucketCountRow {
	n: number;
}

interface FrozenBoundRow {
	lastBucket: string | null;
}

interface BucketContributionRow {
	authorId: number;
	bucket: string;
	replyCount: number;
	discussionCount: number;
}

/**
 * Wipe and recompute every frozen (past) month from base tables. Returns
 * counts for the maintenance result message. Excludes the current month so
 * the live read owns it (no double-count).
 */
export async function rebuildContributionStats(db: D1Db): Promise<RebuildCounts> {
	const curMonthStart = currentMonthStartSec();
	await db.run(sql`DELETE FROM ${contributionBucketStats} WHERE bucket_type = 'month'`);
	await db.run(sql`
		INSERT INTO ${contributionBucketStats} (bucket_type, author_id, bucket, reply_count, discussion_count)
		SELECT 'month', author_id,
			strftime('%Y-%m', datetime(created_at, 'unixepoch')) AS bucket,
			COUNT(*) AS reply_count, 0 AS discussion_count
		FROM ${replies}
		WHERE deleted_at IS NULL AND created_at < ${curMonthStart}
		GROUP BY author_id, bucket
		ON CONFLICT(bucket_type, author_id, bucket) DO UPDATE SET reply_count = excluded.reply_count
	`);
	await db.run(sql`
		INSERT INTO ${contributionBucketStats} (bucket_type, author_id, bucket, reply_count, discussion_count)
		SELECT 'month', author_id,
			strftime('%Y-%m', datetime(created_at, 'unixepoch')) AS bucket,
			0 AS reply_count, COUNT(*) AS discussion_count
		FROM ${discussions}
		WHERE deleted_at IS NULL AND created_at < ${curMonthStart}
		GROUP BY author_id, bucket
		ON CONFLICT(bucket_type, author_id, bucket) DO UPDATE SET discussion_count = excluded.discussion_count
	`);
	const rRows = await db.all<CountRow>(
		sql`SELECT SUM(reply_count) AS total FROM ${contributionBucketStats} WHERE bucket_type = 'month'`
	);
	const dRows = await db.all<CountRow>(
		sql`SELECT SUM(discussion_count) AS total FROM ${contributionBucketStats} WHERE bucket_type = 'month'`
	);
	const nRows = await db.all<BucketCountRow>(
		sql`SELECT COUNT(*) AS n FROM ${contributionBucketStats} WHERE bucket_type = 'month'`
	);
	return {
		replies: Number(rRows[0]?.total ?? 0),
		discussions: Number(dRows[0]?.total ?? 0),
		buckets: Number(nRows[0]?.n ?? 0)
	};
}

async function getFrozenMonthBound(db: D1Db): Promise<string | null> {
	const rows = await db.all<FrozenBoundRow>(sql`
		SELECT MAX(bucket) AS lastBucket FROM ${contributionBucketStats} WHERE bucket_type = 'month'
	`);
	return rows[0]?.lastBucket ?? null;
}

/**
 * Freeze months between MAX(bucket)+1 and the previous calendar month.
 * Idempotent (ON CONFLICT). Returns false if the table is empty (don't
 * lazy-backfill on a read) or already up to date.
 */
export async function freezeRecentContributionStats(db: D1Db): Promise<boolean> {
	const lastFrozen = await getFrozenMonthBound(db);
	if (lastFrozen === null) return false;
	const curMonth = currentMonthKey();
	if (lastFrozen >= prevMonthKey(curMonth)) return false;
	const gapStartSec = monthStartSec(nextMonthKey(lastFrozen));
	const curMonthStartSec = monthStartSec(curMonth);
	await db.run(sql`
		INSERT INTO ${contributionBucketStats} (bucket_type, author_id, bucket, reply_count, discussion_count)
		SELECT 'month', author_id,
			strftime('%Y-%m', datetime(created_at, 'unixepoch')), COUNT(*), 0
		FROM ${replies}
		WHERE deleted_at IS NULL AND created_at >= ${gapStartSec} AND created_at < ${curMonthStartSec}
		GROUP BY author_id, strftime('%Y-%m', datetime(created_at, 'unixepoch'))
		ON CONFLICT(bucket_type, author_id, bucket) DO NOTHING
	`);
	await db.run(sql`
		INSERT INTO ${contributionBucketStats} (bucket_type, author_id, bucket, reply_count, discussion_count)
		SELECT 'month', author_id,
			strftime('%Y-%m', datetime(created_at, 'unixepoch')), 0, COUNT(*)
		FROM ${discussions}
		WHERE deleted_at IS NULL AND created_at >= ${gapStartSec} AND created_at < ${curMonthStartSec}
		GROUP BY author_id, strftime('%Y-%m', datetime(created_at, 'unixepoch'))
		ON CONFLICT(bucket_type, author_id, bucket) DO UPDATE SET discussion_count = excluded.discussion_count
	`);
	return true;
}

/**
 * Decrement the frozen bucket for one author+month on soft-delete. Only past
 * months have rows (the current month is live), so this naturally no-ops for
 * content deleted in the current month. Accepts both the db handle and a
 * transaction so it can sit inside the reply-delete transaction.
 */
export async function decrementContributionStats(
	db: D1Db | DbTransaction,
	authorId: number,
	createdAtUnix: number,
	kind: 'reply' | 'discussion'
): Promise<void> {
	const bucket = monthKeyFromSec(createdAtUnix);
	// sql.raw for the column name: a drizzle Column ref in SET renders
	// table-qualified ("tbl"."col"), which SQLite UPDATE SET rejects. The column
	// name is a fixed literal, so inline it unqualified.
	const column = kind === 'reply' ? 'reply_count' : 'discussion_count';
	await db.run(sql`
		UPDATE ${contributionBucketStats}
		SET ${sql.raw(column)} = MAX(${sql.raw(column)} - 1, 0)
		WHERE bucket_type = 'month' AND author_id = ${authorId} AND bucket = ${bucket}
	`);
}

// --- 'YYYY-MM' helpers (no Date round-trip across the driver boundary) -----

function monthKeyFromSec(unixSec: number): string {
	const d = new Date(unixSec * 1000);
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthStartSec(yyyyMm: string): number {
	const [y, m] = yyyyMm.split('-').map(Number);
	return Math.floor(Date.UTC(y, m - 1, 1) / 1000);
}
function nextMonthKey(yyyyMm: string): string {
	const [y, m] = yyyyMm.split('-').map(Number);
	const year = m === 12 ? y + 1 : y;
	const month = m === 12 ? 1 : m + 1;
	return `${year}-${String(month).padStart(2, '0')}`;
}
function prevMonthKey(yyyyMm: string): string {
	const [y, m] = yyyyMm.split('-').map(Number);
	const year = m === 1 ? y - 1 : y;
	const month = m === 1 ? 12 : m - 1;
	return `${year}-${String(month).padStart(2, '0')}`;
}
function currentMonthStartSec(): number {
	const now = new Date();
	return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
}
function currentMonthKey(): string {
	const now = new Date();
	return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// --- Overview assembly (shared by the live and materialized paths) ---------

interface OverviewAccumulator {
	discussionsByDate: Map<string, number>;
	repliesByDate: Map<string, number>;
	authors: Map<number, AuthorAggregate>;
}

function createOverviewAccumulator(): OverviewAccumulator {
	return { discussionsByDate: new Map(), repliesByDate: new Map(), authors: new Map() };
}

function accumulateContribution(
	acc: OverviewAccumulator,
	authorId: number,
	dateStr: string,
	discussionCount: number,
	replyCount: number
): void {
	if (discussionCount > 0) {
		acc.discussionsByDate.set(dateStr, (acc.discussionsByDate.get(dateStr) ?? 0) + discussionCount);
	}
	if (replyCount > 0) {
		acc.repliesByDate.set(dateStr, (acc.repliesByDate.get(dateStr) ?? 0) + replyCount);
	}
	let aggregate = acc.authors.get(authorId);
	if (!aggregate) {
		aggregate = { discussionsCount: 0, repliesCount: 0, monthly: new Map() };
		acc.authors.set(authorId, aggregate);
	}
	aggregate.discussionsCount += discussionCount;
	aggregate.repliesCount += replyCount;
	const total = discussionCount + replyCount;
	if (total > 0) {
		aggregate.monthly.set(dateStr, (aggregate.monthly.get(dateStr) ?? 0) + total);
	}
}

function rollMapToYear(map: Map<string, number>): Map<string, number> {
	const rolled = new Map<string, number>();
	for (const [key, value] of map) {
		const year = key.substring(0, 4);
		rolled.set(year, (rolled.get(year) ?? 0) + value);
	}
	return rolled;
}

/** Roll month-keyed ('YYYY-MM') structures up to year ('YYYY') for interval=year. */
function rollAccumulatorToYear(acc: OverviewAccumulator): void {
	acc.discussionsByDate = rollMapToYear(acc.discussionsByDate);
	acc.repliesByDate = rollMapToYear(acc.repliesByDate);
	for (const aggregate of acc.authors.values()) {
		aggregate.monthly = rollMapToYear(aggregate.monthly);
	}
}

async function finalizeOverview(
	db: D1Db,
	acc: OverviewAccumulator,
	interval: 'year' | 'month' | 'day'
): Promise<StatsOverview> {
	if (interval === 'year') {
		rollAccumulatorToYear(acc);
	}
	const timeline = fillTimeline(
		mapToStatRows(acc.discussionsByDate),
		mapToStatRows(acc.repliesByDate),
		interval
	);
	if (timeline.length === 0) {
		return { timeline: [], contributors: [], startSec: 0, endSec: 0 };
	}
	const startSec = getIntervalBounds(timeline[0].date, interval).start;
	const endSec = getIntervalBounds(timeline[timeline.length - 1].date, interval).end;
	const dateKeys = generateDateKeys(startSec, endSec, interval);

	const ranked: RankedAuthor[] = [...acc.authors.entries()]
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

/**
 * Live overview: two compound `GROUP BY author_id, strftime(...)` scans of
 * discussions + replies. Fast for narrow ranges (created_at index seek); the
 * ~930ms fallback for range=all when the materialized table is empty.
 */
async function getStatsOverviewLive(
	db: D1Db,
	interval: 'year' | 'month' | 'day',
	rangeStartSec?: number
): Promise<StatsOverview> {
	const format = interval === 'year' ? '%Y' : interval === 'month' ? '%Y-%m' : '%Y-%m-%d';
	const lowerBound = rangeStartSec ?? 0;
	const [dRows, rRows] = await Promise.all([
		db.all<DBAuthorTimelineRow>(sql`
			SELECT author_id AS authorId,
				strftime(${format}, datetime(created_at, 'unixepoch')) AS dateStr,
				COUNT(*) AS count
			FROM ${discussions}
			WHERE deleted_at IS NULL AND created_at >= ${lowerBound}
			GROUP BY author_id, dateStr
		`),
		db.all<DBAuthorTimelineRow>(sql`
			SELECT author_id AS authorId,
				strftime(${format}, datetime(created_at, 'unixepoch')) AS dateStr,
				COUNT(*) AS count
			FROM ${replies}
			WHERE deleted_at IS NULL AND created_at >= ${lowerBound}
			GROUP BY author_id, dateStr
		`)
	]);
	const acc = createOverviewAccumulator();
	for (const row of dRows) {
		accumulateContribution(acc, Number(row.authorId), row.dateStr, Number(row.count), 0);
	}
	for (const row of rRows) {
		accumulateContribution(acc, Number(row.authorId), row.dateStr, 0, Number(row.count));
	}
	return finalizeOverview(db, acc, interval);
}

/**
 * Admin overview. Uses the materialized contribution_bucket_stats table for
 * range=all + month/year (the slow case: aggregating 677K reply rows drops
 * from ~930ms to ~13ms). Ranged views and interval=day stay live (they are
 * already fast via the created_at index and avoid the partial-month boundary
 * mismatch with month-granular frozen buckets). day + all is clamped to month.
 */
export async function getStatsOverview(
	db: D1Db,
	interval: 'year' | 'month' | 'day',
	rangeStartSec?: number
): Promise<StatsOverview> {
	if (interval === 'day' && rangeStartSec === undefined) {
		interval = 'month';
	}
	// Ranged views and day granularity: live (fast, exact).
	if (rangeStartSec !== undefined || interval === 'day') {
		return getStatsOverviewLive(db, interval, rangeStartSec);
	}

	// range=all + (month|year): materialized if the table is populated.
	const lastFrozen = await getFrozenMonthBound(db);
	if (lastFrozen === null) {
		return getStatsOverviewLive(db, interval, rangeStartSec);
	}
	// Lazy-freeze any completed months not yet materialized (bounded, idempotent).
	try {
		await freezeRecentContributionStats(db);
	} catch {
		// A freeze failure must never break the read; fall back to live-only.
		return getStatsOverviewLive(db, interval, rangeStartSec);
	}

	const curMonth = currentMonthKey();
	const curMonthStart = monthStartSec(curMonth);
	const acc = createOverviewAccumulator();

	// Frozen past months (the table only ever holds months < currentMonth).
	const frozenRows = await db.all<BucketContributionRow>(sql`
		SELECT author_id AS authorId, bucket AS bucket,
			reply_count AS replyCount, discussion_count AS discussionCount
		FROM ${contributionBucketStats}
		WHERE bucket_type = 'month' AND bucket < ${curMonth}
	`);
	for (const row of frozenRows) {
		accumulateContribution(
			acc,
			Number(row.authorId),
			row.bucket,
			Number(row.discussionCount),
			Number(row.replyCount)
		);
	}

	// Live current month (month granularity; rolled to year in finalize if needed).
	const [dRows, rRows] = await Promise.all([
		db.all<DBAuthorTimelineRow>(sql`
			SELECT author_id AS authorId,
				strftime('%Y-%m', datetime(created_at, 'unixepoch')) AS dateStr,
				COUNT(*) AS count
			FROM ${discussions}
			WHERE deleted_at IS NULL AND created_at >= ${curMonthStart}
			GROUP BY author_id, dateStr
		`),
		db.all<DBAuthorTimelineRow>(sql`
			SELECT author_id AS authorId,
				strftime('%Y-%m', datetime(created_at, 'unixepoch')) AS dateStr,
				COUNT(*) AS count
			FROM ${replies}
			WHERE deleted_at IS NULL AND created_at >= ${curMonthStart}
			GROUP BY author_id, dateStr
		`)
	]);
	for (const row of dRows) {
		accumulateContribution(acc, Number(row.authorId), row.dateStr, Number(row.count), 0);
	}
	for (const row of rRows) {
		accumulateContribution(acc, Number(row.authorId), row.dateStr, 0, Number(row.count));
	}

	return finalizeOverview(db, acc, interval);
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
