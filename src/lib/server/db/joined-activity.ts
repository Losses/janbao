/**
 * Write-time upsert for "who joined" activities.
 *
 * One isJoined activity row per calendar day (FORUM_TIMEZONE). When a user
 * registers (or an imported registration event is replayed), this appends the
 * user into that day's join activity — creating it if today is the first
 * signup. Reads stay trivial (a normal activity row) and feeds/pagination need
 * no special-casing; the joined render pipeline surfaces the member list from
 * activity_joins.
 */
import { activities, activityJoins } from './schema';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { D1Db, DbTransaction } from './index';
import { SYSTEM_USER_ID, getForumTimezone } from '../constants';
import { getTzBoundaries } from './welcome';

// Either the db instance or an in-flight transaction — both expose the same
// query-builder API (select/insert/update/where), so this helper runs
// identically whether called from the signup transaction (tx) or the import
// script (which has no transaction and passes the db handle directly).
type DbOrTx = D1Db | DbTransaction;

// Minimal non-empty Lexical doc for a join activity's contentJson (the column is
// NOT NULL). The joined render pipeline ignores this and renders from
// activity_joins; we still store a valid empty-ish doc.
const PLACEHOLDER_CONTENT = JSON.stringify({
	root: {
		type: 'root',
		direction: 'ltr',
		format: '',
		indent: 0,
		version: 1,
		children: []
	}
});

/**
 * Append `userId` into today's isJoined activity (creating it if absent), using
 * `joinedAt` as both the day-bucket key and the activity's createdAt.
 *
 * Pass a transaction from the signup flow so the join row commits atomically
 * with the new user; the import script passes its db handle directly.
 */
export async function appendJoinedMember(
	dbOrTx: DbOrTx,
	userId: number,
	joinedAt: Date,
	platformEnv: App.Platform['env'] | undefined
): Promise<void> {
	const tz = getForumTimezone(platformEnv);
	// Bucket by the calendar day of `joinedAt` in the forum timezone.
	const dayStr = formatDay(joinedAt, tz);
	const { start, end } = getTzBoundaries(dayStr, tz);

	// Find today's existing isJoined activity (one per day).
	const existing = await dbOrTx
		.select({ id: activities.id })
		.from(activities)
		.where(
			and(
				eq(activities.isJoined, true),
				gte(activities.createdAt, start),
				lte(activities.createdAt, end)
			)
		)
		.limit(1);

	let activityId: number;
	if (existing.length > 0) {
		activityId = existing[0].id;
	} else {
		const inserted = await dbOrTx
			.insert(activities)
			.values({
				authorId: SYSTEM_USER_ID,
				recipientId: null,
				parentActivityId: null,
				contentJson: PLACEHOLDER_CONTENT,
				isJoined: true,
				createdAt: joinedAt,
				updatedAt: joinedAt
			})
			.returning({ id: activities.id });
		activityId = inserted[0].id;
	}

	// Append the member (idempotent on the (activityId, userId) PK).
	await dbOrTx
		.insert(activityJoins)
		.values({ activityId, userId, joinedAt })
		.onConflictDoNothing();
}

/**
 * Count how many distinct users are members of an isJoined activity. Used by
 * render loaders.
 */
export async function countJoinedMembers(db: D1Db, activityId: number): Promise<number> {
	const rows = await db
		.select({ n: sql<number>`COUNT(*)` })
		.from(activityJoins)
		.where(eq(activityJoins.activityId, activityId));
	return rows[0]?.n ?? 0;
}

/** format a Date as YYYY-MM-DD in the given timezone (Intl en-CA gives that). */
function formatDay(date: Date, tz: string): string {
	try {
		return new Intl.DateTimeFormat('en-CA', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(date);
	} catch {
		return date.toISOString().split('T')[0];
	}
}
