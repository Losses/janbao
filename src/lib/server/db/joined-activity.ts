/**
 * Write-time upsert for "who joined" activities.
 *
 * One isJoined activity row per calendar day (FORUM_TIMEZONE). When a user
 * registers (or an imported registration event is replayed), this appends the
 * user into that day's join activity - creating it if today is the first
 * signup. Reads stay trivial (a normal activity row) and feeds/pagination need
 * no special-casing; the joined render pipeline surfaces the member list from
 * activity_joins.
 */
import { activities, activityJoins } from './schema';
import { eq, sql } from 'drizzle-orm';
import type { D1Db, DbTransaction } from './index';
import { SYSTEM_USER_ID, getForumTimezone } from '../constants';

// Either the db instance or an in-flight transaction - both expose the same
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
	// Bucket by the calendar day of `joinedAt` in the forum timezone. Same
	// value is stored on joined_day so the UNIQUE(is_joined, joined_day)
	// index can serialize concurrent first-of-the-day inserts.
	const dayStr = formatDay(joinedAt, tz);

	// Upsert today's isJoined activity. The ON CONFLICT branch targets the
	// UNIQUE(is_joined, joined_day) index: two concurrent signups on the same
	// day both compute the same joined_day, the index serializes them, and
	// the second one folds onto the first writer's id - guaranteeing exactly
	// one activity row per day bucket. The SET clause bumps updated_at to
	// the new join time, matching the column's documented purpose ("activity
	// feed can order by last-updated"); created_at and content_json are left
	// untouched so the row remains anchored to the day's first signup.
	const upserted = await dbOrTx
		.insert(activities)
		.values({
			authorId: SYSTEM_USER_ID,
			recipientId: null,
			parentActivityId: null,
			contentJson: PLACEHOLDER_CONTENT,
			isJoined: true,
			joinedDay: dayStr,
			createdAt: joinedAt,
			updatedAt: joinedAt
		})
		.onConflictDoUpdate({
			target: [activities.isJoined, activities.joinedDay],
			set: { updatedAt: joinedAt }
		})
		.returning({ id: activities.id });
	const activityId = upserted[0].id;

	// Append the member (idempotent on the (activityId, userId) PK).
	await dbOrTx.insert(activityJoins).values({ activityId, userId, joinedAt }).onConflictDoNothing();
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
