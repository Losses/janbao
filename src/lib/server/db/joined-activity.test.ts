import { test, expect } from 'bun:test';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import * as schema from './schema';
import { activities, activityJoins, users, userGroups } from './schema';
import type { D1Db } from './index';
import { SYSTEM_USER_ID } from '$lib/server/constants';
import { appendJoinedMember } from './joined-activity';

// Drizzle's libsql driver is structurally compatible with the D1 driver for
// the queries appendJoinedMember issues; bridge the types the same way
// db/index.ts does.
function castDb<T>(value: unknown): T {
	return value as T;
}

interface SetupResult {
	db: D1Db;
	client: Client;
}

// migrate() expects the libsql-typed drizzle instance, not the D1-bridged alias
// we hand appendJoinedMember. Bridge it back via castDb so no `as unknown`
// appears at the call site.
type MigratableDb = Parameters<typeof migrate>[0];

const SYSTEM_GROUP = 'system';
const MEMBER_GROUP = 'member';

async function setup(): Promise<SetupResult> {
	const client = createClient({ url: ':memory:' });
	const db = castDb<D1Db>(drizzle(client, { schema }));
	await migrate(castDb<MigratableDb>(db), {
		migrationsFolder: 'drizzle/local-migrations'
	});

	await db
		.insert(userGroups)
		.values([
			{ slug: SYSTEM_GROUP, title: 'System', description: 'system' },
			{ slug: MEMBER_GROUP, title: 'Member', description: 'member' }
		])
		.run();

	await db
		.insert(users)
		.values({
			id: SYSTEM_USER_ID,
			username: 'system',
			email: 'system@janbao.local',
			passwordHash: 'SYSTEM_NO_PASSWORD',
			displayName: 'System',
			groupSlug: SYSTEM_GROUP,
			isStealth: true
		})
		.run();

	await db
		.insert(users)
		.values([
			{
				id: 1,
				username: 'alpha',
				email: 'a@x',
				passwordHash: 'h',
				displayName: 'A',
				groupSlug: MEMBER_GROUP
			},
			{
				id: 2,
				username: 'beta',
				email: 'b@x',
				passwordHash: 'h',
				displayName: 'B',
				groupSlug: MEMBER_GROUP
			}
		])
		.run();

	return { db, client };
}

async function joinedActivityCount(db: D1Db): Promise<number> {
	const rows = await db
		.select({ id: activities.id, joinedDay: activities.joinedDay })
		.from(activities)
		.where(eq(activities.isJoined, true))
		.all();
	return rows.length;
}

async function joinedMemberIds(db: D1Db, activityId: number): Promise<Set<number>> {
	const rows = await db
		.select({ userId: activityJoins.userId })
		.from(activityJoins)
		.where(eq(activityJoins.activityId, activityId))
		.all();
	return new Set(rows.map((r) => r.userId));
}

// Regression: the UNIQUE(is_joined, joined_day) index plus ON CONFLICT DO
// UPDATE must collapse a sequential second-of-the-day signup onto the existing
// activity row instead of creating a duplicate, so the day-bucket rollup
// counts each member exactly once.
test('appendJoinedMember: second same-day signup reuses the existing activity row', async () => {
	const { db, client } = await setup();
	const joinedAt = new Date('2026-07-20T10:00:00Z');

	await appendJoinedMember(db, 1, joinedAt, undefined);
	await appendJoinedMember(db, 2, joinedAt, undefined);

	expect(await joinedActivityCount(db)).toBe(1);

	const rows = await db
		.select({ id: activities.id })
		.from(activities)
		.where(eq(activities.isJoined, true))
		.all();
	const members = await joinedMemberIds(db, rows[0].id);
	expect(members).toEqual(new Set([1, 2]));

	client.close();
});

// Preventive race test: two concurrent appendJoinedMember calls on the same
// calendar day must collapse into a single isJoined activity row. The
// UNIQUE(is_joined, joined_day) index serializes the inserts; the ON CONFLICT
// DO UPDATE branch returns the survivor's id to both callers, so each user
// lands in activity_joins exactly once.
test('appendJoinedMember: parallel same-day inserts collapse to one row (race fix)', async () => {
	const { db, client } = await setup();
	const joinedAt = new Date('2026-07-20T10:00:00Z');

	await Promise.all([
		appendJoinedMember(db, 1, joinedAt, undefined),
		appendJoinedMember(db, 2, joinedAt, undefined)
	]);

	expect(await joinedActivityCount(db)).toBe(1);

	const rows = await db
		.select({ id: activities.id })
		.from(activities)
		.where(eq(activities.isJoined, true))
		.all();
	const members = await joinedMemberIds(db, rows[0].id);
	expect(members).toEqual(new Set([1, 2]));

	client.close();
});

// Cross-day isolation guard: signups on different days must produce distinct
// activity rows so the per-day rollup granularity is preserved (the UNIQUE
// index must not collapse across day boundaries).
test('appendJoinedMember: different days produce distinct activity rows', async () => {
	const { db, client } = await setup();

	await appendJoinedMember(db, 1, new Date('2026-07-20T10:00:00Z'), undefined);
	await appendJoinedMember(db, 2, new Date('2026-07-21T10:00:00Z'), undefined);

	expect(await joinedActivityCount(db)).toBe(2);

	client.close();
});
