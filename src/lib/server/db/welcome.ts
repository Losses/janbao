import { users, activities } from './schema';
import { and, gte, lte, eq, sql } from 'drizzle-orm';
import type { D1Db } from './index';
import { SYSTEM_USER_ID } from '../constants';
import { generateSlug } from '$lib/utils/slug';

let lastCheckedDateStr = '';

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
 * Calculates start and end Date objects for a date string in a given timezone.
 */
/**
 * A UTC Date boundary window { start, end }. The inclusivity of `end` is
 * producer-specific - see each function's JSDoc. Callers must pair a boundary
 * with the comparator matching its producer (inclusive → `lte`, half-open → `lt`).
 */
export interface DateBoundary {
	start: Date;
	end: Date;
}

/**
 * Day boundaries for `dateStr` in `tz`. Returns a **closed** window
 * `[start, end]` where `end` is the last millisecond of the day - pair with
 * `lte(column, end)`.
 */
export function getTzBoundaries(dateStr: string, tz: string): DateBoundary {
	const datePart = dateStr.split('-');
	const year = parseInt(datePart[0], 10);
	const month = parseInt(datePart[1], 10) - 1;
	const day = parseInt(datePart[2], 10);

	const dateUtc = new Date(Date.UTC(year, month, day, 0, 0, 0));
	const offsetMinutes = getTzOffsetMinutes(dateUtc, tz);

	const startMs = Date.UTC(year, month, day, 0, 0, 0) - offsetMinutes * 60 * 1000;
	const endMs = startMs + 24 * 60 * 60 * 1000 - 1;

	return {
		start: new Date(startMs),
		end: new Date(endMs)
	};
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

/**
 * Checks and creates the deterministic Daily Welcome Post in activities.
 */
export async function checkAndCreateWelcomePost(
	db: D1Db,
	platformEnv: App.Platform['env'] | undefined
) {
	const tz = platformEnv?.FORUM_TIMEZONE || process.env.FORUM_TIMEZONE || 'UTC';
	const now = new Date();

	// Format current day in timezone YYYY-MM-DD
	let todayStr: string;
	try {
		todayStr = new Intl.DateTimeFormat('en-CA', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(now);
	} catch {
		// Fallback
		todayStr = now.toISOString().split('T')[0];
	}

	// If already checked today, skip db evaluations
	if (lastCheckedDateStr === todayStr) {
		return;
	}

	lastCheckedDateStr = todayStr;

	// Calculate yesterday's date string
	const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
	let yesterdayStr: string;
	try {
		yesterdayStr = new Intl.DateTimeFormat('en-CA', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(yesterday);
	} catch {
		yesterdayStr = yesterday.toISOString().split('T')[0];
	}

	const welcomePostId = `welcome-${yesterdayStr}`;

	try {
		// 1. Check if welcome post already exists
		const existing = await db
			.select({ id: activities.id })
			.from(activities)
			.where(eq(activities.id, welcomePostId))
			.limit(1);

		if (existing.length > 0) {
			return;
		}

		// 2. Resolve yesterday's start and end times
		const { start, end } = getTzBoundaries(yesterdayStr, tz);

		// 3. Query new users registered yesterday (excluding System user)
		const newUsers = await db
			.select({
				id: users.id,
				username: users.username,
				displayName: users.displayName
			})
			.from(users)
			.where(
				and(
					gte(users.signupTime, start),
					lte(users.signupTime, end),
					sql`${users.id} != ${SYSTEM_USER_ID}`
				)
			);

		if (newUsers.length === 0) {
			return;
		}

		// 4. Construct Lexical JSON
		const welcomeHeader =
			platformEnv?.WELCOME_TEXT ||
			process.env.WELCOME_TEXT ||
			'Welcome our new members who joined yesterday: ';

		const paragraphChildren: Array<Record<string, unknown>> = [
			{
				detail: 0,
				format: 0,
				mode: 'normal',
				style: '',
				text: welcomeHeader,
				type: 'text',
				version: 1
			}
		];

		newUsers.forEach((u, idx) => {
			const uSlug = generateSlug(u.username || u.displayName || 'user');
			paragraphChildren.push({
				children: [
					{
						detail: 0,
						format: 0,
						mode: 'normal',
						style: '',
						text: u.displayName,
						type: 'text',
						version: 1
					}
				],
				direction: 'ltr',
				format: '',
				indent: 0,
				type: 'link',
				url: `/profile/${u.id}/${uSlug}`,
				version: 1
			});

			if (idx < newUsers.length - 1) {
				paragraphChildren.push({
					detail: 0,
					format: 0,
					mode: 'normal',
					style: '',
					text: ', ',
					type: 'text',
					version: 1
				});
			}
		});

		const contentJsonObj = {
			root: {
				children: [
					{
						children: paragraphChildren,
						direction: 'ltr',
						format: '',
						indent: 0,
						type: 'paragraph',
						version: 1
					}
				],
				direction: 'ltr',
				format: '',
				indent: 0,
				type: 'root',
				version: 1
			}
		};

		// 5. Insert deterministic activity post
		await db
			.insert(activities)
			.values({
				id: welcomePostId,
				authorId: SYSTEM_USER_ID,
				recipientId: null,
				parentActivityId: null,
				contentJson: JSON.stringify(contentJsonObj),
				createdAt: new Date()
			})
			.onConflictDoNothing(); // Ignore uniqueness constraint errors on concurrent insert attempts
	} catch (e) {
		console.error('Failed to generate daily welcome post:', e);
	}
}
