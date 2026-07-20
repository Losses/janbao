import { test, expect } from 'bun:test';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import * as schema from './schema';
import {
	userGroups,
	users,
	categories,
	discussions,
	replies,
	notifications,
	notificationPreferences
} from './schema';
import type { D1Db } from './index';
import { SYSTEM_USER_ID, GHOST_USER_ID } from '$lib/server/constants';
import { dispatchReplyNotifications } from './notifications';

// Drizzle's libsql driver is structurally compatible with the D1 driver for the
// queries dispatchReplyNotifications issues; bridge the types the same way
// db/index.ts does.
function castDb<T>(value: unknown): T {
	return value as T;
}

interface TestDb {
	db: D1Db;
	client: Client;
}

const MEMBER_GROUP = 'member';
const SYSTEM_GROUP = 'system';
const CATEGORY_SLUG = 'test-cat';

// migrate() expects the libsql-typed drizzle instance, not the D1-bridged alias
// we hand the dispatcher. Bridge it back via castDb (the same trick db/index.ts
// uses in reverse) so no `as unknown` appears at the call site.
type MigratableDb = Parameters<typeof migrate>[0];

interface SetupResult extends TestDb {
	authorId: number;
	mentionedRealUserId: number;
	discussionId: number;
}

async function setup(): Promise<SetupResult> {
	const client = createClient({ url: ':memory:' });
	const db = castDb<D1Db>(drizzle(client, { schema }));
	await migrate(castDb<MigratableDb>(db), {
		migrationsFolder: 'drizzle/local-migrations'
	});

	// Seed groups + sentinels + a real author + a real mentioned user.
	await db
		.insert(userGroups)
		.values([
			{ slug: SYSTEM_GROUP, title: 'System', description: 'system' },
			{ slug: MEMBER_GROUP, title: 'Member', description: 'member' }
		])
		.run();

	// The System sentinel (-1): seeded with isStealth=true and a literal
	// username 'system' so a literal @system mention resolves to this row.
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

	// Author (id 1) and a real mentioned user (id 2).
	await db
		.insert(users)
		.values([
			{
				id: 1,
				username: 'author',
				email: 'author@x',
				passwordHash: 'h',
				displayName: 'Author',
				groupSlug: MEMBER_GROUP
			},
			{
				id: 2,
				username: 'realuser',
				email: 'real@x',
				passwordHash: 'h',
				displayName: 'Real',
				groupSlug: MEMBER_GROUP
			}
		])
		.run();

	await db.insert(categories).values({ slug: CATEGORY_SLUG, title: 'c', description: 'c' }).run();

	await db
		.insert(discussions)
		.values({
			id: 100,
			title: 'thread',
			slug: 'thread',
			categorySlug: CATEGORY_SLUG,
			authorId: 1
		})
		.run();

	// The reply row itself is not strictly required by the dispatcher, but its
	// content is what a real caller passes in via ctx.contentJson.
	await db
		.insert(replies)
		.values({
			id: 999,
			discussionId: 100,
			authorId: 1,
			contentJson: mentionContent(['system', 'realuser'])
		})
		.run();

	return { db, client, authorId: 1, mentionedRealUserId: 2, discussionId: 100 };
}

// Build a minimal Lexical JSON document whose text nodes contain @<username>
// tokens so extractMentions picks them up the same way real editor content does.
function mentionContent(usernames: string[]): string {
	const text = usernames.map((u) => `@${u}`).join(' ');
	return JSON.stringify({
		root: {
			type: 'root',
			children: [
				{
					type: 'paragraph',
					children: [{ type: 'text', text }]
				}
			]
		}
	});
}

async function notificationRowsFor(db: D1Db, userId: number) {
	return db.select().from(notifications).where(eq(notifications.userId, userId)).all();
}

// Sentinel guard regression: a literal @system mention resolves to the seeded
// System row (id -1), but the dispatcher must drop it from mentionIds via
// isRealUserId so no notification row is ever written for a sentinel account.
// Without the guard, a real notifications.userId=-1 row would be inserted
// (the FK on notifications.userId -> users.id is satisfied because System is a
// real row), which is semantically wrong and wastes storage on a non-recipient.
test('dispatchReplyNotifications: never writes a notification for the System sentinel', async () => {
	const { db, authorId, discussionId } = await setup();

	const created = await dispatchReplyNotifications(db, {
		discussionId,
		replyId: 999,
		authorId,
		contentJson: mentionContent(['system', 'realuser'])
	});

	// No created row should target the sentinel.
	expect(created.find((r) => r.userId === SYSTEM_USER_ID)).toBeUndefined();
	expect(created.find((r) => r.userId === GHOST_USER_ID)).toBeUndefined();

	// And no row for the sentinel was actually written to the DB.
	const systemRows = await notificationRowsFor(db, SYSTEM_USER_ID);
	expect(systemRows.length).toBe(0);
});

// Counter-guard: a real mentioned user still receives exactly one notification,
// so the sentinel filter is not over-broad (does not drop legitimate recipients).
test('dispatchReplyNotifications: still notifies a real mentioned user', async () => {
	const { db, authorId, mentionedRealUserId, discussionId } = await setup();

	const created = await dispatchReplyNotifications(db, {
		discussionId,
		replyId: 999,
		authorId,
		contentJson: mentionContent(['system', 'realuser'])
	});

	expect(created.find((r) => r.userId === mentionedRealUserId)).toBeDefined();
	const realRows = await notificationRowsFor(db, mentionedRealUserId);
	expect(realRows.length).toBe(1);
	expect(realRows[0].type).toBe('mention');
});

// Stealth is a presence opt-out, not a mention opt-out: a stealth user keeps
// receiving @mention notifications (their username was typed explicitly).
// Locks the stealth semantic so a later "defense-in-depth" change does not
// silently drop legitimate @mention recipients.
test('dispatchReplyNotifications: still notifies a stealth user (stealth != mention opt-out)', async () => {
	const { db, client } = await setup();

	// Add a stealth real user (id 3) and mention them.
	await db
		.insert(users)
		.values({
			id: 3,
			username: 'stealthy',
			email: 'stealth@x',
			passwordHash: 'h',
			displayName: 'Stealthy',
			groupSlug: MEMBER_GROUP,
			isStealth: true
		})
		.run();

	const created = await dispatchReplyNotifications(db, {
		discussionId: 100,
		replyId: 999,
		authorId: 1,
		contentJson: mentionContent(['stealthy'])
	});

	expect(created.find((r) => r.userId === 3)).toBeDefined();
	const rows = await notificationRowsFor(db, 3);
	expect(rows.length).toBe(1);
	expect(rows[0].type).toBe('mention');

	client.close();
});

// The preference default-true rule applies independently of the sentinel guard:
// even without an explicit notificationPreferences row, a real mentioned user is
// eligible (the dispatcher must not require a pref row to surface a mention).
test('dispatchReplyNotifications: mention eligible by default without a pref row', async () => {
	const { db, mentionedRealUserId, authorId, discussionId } = await setup();

	// Confirm no pref row exists for the real user.
	const prefs = await db
		.select()
		.from(notificationPreferences)
		.where(eq(notificationPreferences.userId, mentionedRealUserId))
		.all();
	expect(prefs.length).toBe(0);

	const created = await dispatchReplyNotifications(db, {
		discussionId,
		replyId: 999,
		authorId,
		contentJson: mentionContent(['realuser'])
	});

	expect(created.find((r) => r.userId === mentionedRealUserId)).toBeDefined();
});
