import { test, expect } from 'bun:test';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../schema';
import { categories, discussions, replies, userGroups, users } from '../schema';
import type { D1Db } from '../index';
import { getRepliesForDepth, getReplyEndpointsFor, type ReplyBackfillDepth } from './sync';

// Drizzle's libsql driver is structurally compatible with the D1 driver for the
// queries sync.ts issues; bridge the types the same way db/index.ts does.
function castDb<T>(value: unknown): T {
	return value as T;
}

interface TestDb {
	db: D1Db;
	client: Client;
}

const PAGE_SIZE = 50;
const GROUP_SLUG = 'test-group';
const SLUG = 'test-cat';

// migrate() expects the libsql-typed drizzle instance, not the D1-bridged alias
// we hand the DAO. Bridge it back via castDb (the same trick db/index.ts uses
// in reverse) so no `as unknown` appears at the call site.
type MigratableDb = Parameters<typeof migrate>[0];

async function setup(): Promise<TestDb> {
	const client = createClient({ url: ':memory:' });
	const db = castDb<D1Db>(drizzle(client, { schema }));
	await migrate(castDb<MigratableDb>(db), {
		migrationsFolder: 'drizzle/local-migrations'
	});
	// Seed the user_group + a single author + a category that the discussion /
	// reply FKs point at.
	await db.insert(userGroups).values({ slug: GROUP_SLUG, title: 'g', description: 'g' }).run();
	await db
		.insert(users)
		.values({
			id: 1,
			username: 'u',
			email: 'u@x',
			passwordHash: 'h',
			displayName: 'U',
			groupSlug: GROUP_SLUG
		})
		.run();
	await db.insert(categories).values({ slug: SLUG, title: 'c', description: 'c' }).run();
	return { db, client };
}

async function seedDiscussion(db: D1Db, id: number, commentCount: number): Promise<void> {
	await db
		.insert(discussions)
		.values({
			id,
			title: `thread-${id}`,
			slug: `thread-${id}`,
			categorySlug: SLUG,
			authorId: 1,
			commentCount,
			isPinned: false
		})
		.run();
}

async function seedReplies(db: D1Db, discussionId: number, count: number): Promise<void> {
	// Distinct createdAt (ascending seconds) so ROW_NUMBER() ORDER BY is
	// deterministic across runs even with same-second inserts.
	const baseSec = discussionId * 100_000;
	for (let i = 1; i <= count; i++) {
		await db
			.insert(replies)
			.values({
				id: discussionId * 1_000_000 + i,
				discussionId,
				authorId: 1,
				contentJson: `{"r":${i}}`,
				createdAt: new Date((baseSec + i) * 1000)
			})
			.run();
	}
}

interface ReplyIdOrder {
	asc: number[];
	desc: number[];
}

async function replyIdsFor(db: D1Db, discussionId: number): Promise<ReplyIdOrder> {
	const rows = await db
		.select({ id: replies.id })
		.from(replies)
		.where(eq(replies.discussionId, discussionId))
		.orderBy(replies.id);
	const ids = rows.map((r) => r.id);
	return { asc: ids, desc: [...ids].reverse() };
}

test('getRepliesForDepth depth=all ships every reply under-cap (≤1000)', async () => {
	const { db } = await setup();

	await seedDiscussion(db, 1001, 1000);
	await seedReplies(db, 1001, 1000);

	const res = await getRepliesForDepth(db, [1001], 'all', PAGE_SIZE, [SLUG]);
	expect(res.replies.length).toBe(1000);
	expect(res.partialDiscussionIds).toEqual([]);
});

test('getRepliesForDepth depth=all ships first 250 + last 250 over-cap (>1000)', async () => {
	const { db } = await setup();

	await seedDiscussion(db, 1003, 2000);
	await seedReplies(db, 1003, 2000);

	const res = await getRepliesForDepth(db, [1003], 'all', PAGE_SIZE, [SLUG]);
	expect(res.replies.length).toBe(500);

	const { asc, desc } = await replyIdsFor(db, 1003);
	const first250 = new Set(asc.slice(0, 250));
	const last250 = new Set(desc.slice(0, 250));
	const shippedIds = new Set(res.replies.map((r) => r.id));
	for (const id of first250) expect(shippedIds.has(id)).toBe(true);
	for (const id of last250) expect(shippedIds.has(id)).toBe(true);
	// a known middle reply is NOT shipped (the gap)
	const middleId = asc[1000];
	expect(shippedIds.has(middleId)).toBe(false);
	expect(res.partialDiscussionIds).toEqual([1003]);
});

test('getRepliesForDepth depth=first partial iff total > pageSize', async () => {
	const { db } = await setup();

	await seedDiscussion(db, 1004, PAGE_SIZE + 1);
	await seedDiscussion(db, 1005, PAGE_SIZE);
	await seedReplies(db, 1004, PAGE_SIZE + 1);
	await seedReplies(db, 1005, PAGE_SIZE);

	const res = await getRepliesForDepth(db, [1004, 1005], 'first', PAGE_SIZE, [SLUG]);
	// page 1 of each ⇒ 2 * PAGE_SIZE rows total
	expect(res.replies.length).toBe(PAGE_SIZE * 2);
	expect(res.partialDiscussionIds).toEqual([1004]);
});

test('getRepliesForDepth depth=firstLast delegates partial contract (totalPages > 2)', async () => {
	const { db } = await setup();

	await seedDiscussion(db, 1006, PAGE_SIZE * 3);
	await seedDiscussion(db, 1007, PAGE_SIZE * 2);
	await seedReplies(db, 1006, PAGE_SIZE * 3);
	await seedReplies(db, 1007, PAGE_SIZE * 2);

	const res = await getRepliesForDepth(db, [1006, 1007], 'firstLast', PAGE_SIZE, [SLUG]);
	expect(res.partialDiscussionIds).toEqual([1006]);
});

test('getReplyEndpointsFor partial contract matches firstLast depth', async () => {
	const { db } = await setup();

	await seedDiscussion(db, 1006, PAGE_SIZE * 3);
	await seedDiscussion(db, 1007, PAGE_SIZE * 2);
	await seedReplies(db, 1006, PAGE_SIZE * 3);
	await seedReplies(db, 1007, PAGE_SIZE * 2);

	const direct = await getReplyEndpointsFor(db, [1006, 1007], PAGE_SIZE, [SLUG]);
	const viaDepth = await getRepliesForDepth(
		db,
		[1006, 1007],
		'firstLast' as ReplyBackfillDepth,
		PAGE_SIZE,
		[SLUG]
	);
	expect(direct.partialDiscussionIds).toEqual([1006]);
	expect(direct.partialDiscussionIds).toEqual(viaDepth.partialDiscussionIds);
	expect(direct.replies.length).toBe(viaDepth.replies.length);
});

test('getRepliesForDepth honors readableSlugs scoping (no leak)', async () => {
	const { db } = await setup();

	await seedDiscussion(db, 1003, 2000);
	await seedReplies(db, 1003, 2000);

	const res = await getRepliesForDepth(db, [1003], 'all', PAGE_SIZE, ['other-cat']);
	expect(res.replies).toEqual([]);
	expect(res.partialDiscussionIds).toEqual([]);
});
