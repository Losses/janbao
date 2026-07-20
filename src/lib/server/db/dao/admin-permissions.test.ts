import { test, expect } from 'bun:test';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../schema';
import { userGroups, categories } from '../schema';
import type { D1Db } from '../index';
import { createCategory, createUserGroup } from './admin-permissions';
import type { AdminCategoryItem } from '$lib/types/api';

// Drizzle's libsql driver is structurally compatible with the D1 driver for the
// queries these DAOs issue; bridge the types the same way db/index.ts does.
function castDb<T>(value: unknown): T {
	return value as T;
}

type MigratableDb = Parameters<typeof migrate>[0];

interface TestDb {
	db: D1Db;
	client: Client;
}

async function setup(): Promise<TestDb> {
	const client = createClient({ url: ':memory:' });
	const db = castDb<D1Db>(drizzle(client, { schema }));
	await migrate(castDb<MigratableDb>(db), {
		migrationsFolder: 'drizzle/local-migrations'
	});
	return { db, client };
}

async function countUserGroupRows(db: D1Db, slug: string): Promise<number> {
	const rows = await db
		.select({ slug: userGroups.slug })
		.from(userGroups)
		.where(eq(userGroups.slug, slug));
	return rows.length;
}

async function countCategoryRows(db: D1Db, slug: string): Promise<number> {
	const rows = await db
		.select({ slug: categories.slug })
		.from(categories)
		.where(eq(categories.slug, slug));
	return rows.length;
}

function sampleCategory(slug: string): AdminCategoryItem {
	return {
		slug,
		title: `${slug}-title`,
		description: `${slug}-desc`,
		priority: 1,
		displayOrder: 1,
		themeName: null,
		disabledAt: null
	};
}

// Fresh insert: returns true and persists the row.
test('createUserGroup inserts a new group and returns true', async () => {
	const { db } = await setup();

	const created = await createUserGroup(db, 'editors', 'Editors', 'Editor group');

	expect(created).toBe(true);
	expect(await countUserGroupRows(db, 'editors')).toBe(1);
});

// Race guard (pre-existing row): a second insert on the same slug must fold to
// a no-op. This is the contract the route handler relies on to map a lost
// create race to a 409.
test('createUserGroup returns false on a pre-existing slug without throwing', async () => {
	const { db } = await setup();

	expect(await createUserGroup(db, 'editors', 'Editors', 'Editor group')).toBe(true);

	const second = await createUserGroup(db, 'editors', 'Editors', 'Editor group');

	expect(second).toBe(false);
	expect(await countUserGroupRows(db, 'editors')).toBe(1);
});

// Concurrent duplicate: two parallel inserts on the same slug must produce
// exactly one row; one call wins (true), the other folds (false), neither
// throws. This is the preventive regression for the duplicate-create race.
test('createUserGroup parallel duplicate calls produce exactly one row', async () => {
	const { db } = await setup();

	const [a, b] = await Promise.all([
		createUserGroup(db, 'editors', 'Editors', 'Editor group'),
		createUserGroup(db, 'editors', 'Editors', 'Editor group')
	]);

	expect([a, b].filter((v) => v === true)).toHaveLength(1);
	expect([a, b].filter((v) => v === false)).toHaveLength(1);
	expect(await countUserGroupRows(db, 'editors')).toBe(1);
});

// Fresh insert for categories.
test('createCategory inserts a new category and returns true', async () => {
	const { db } = await setup();

	const created = await createCategory(db, sampleCategory('announcements'));

	expect(created).toBe(true);
	expect(await countCategoryRows(db, 'announcements')).toBe(1);
});

// Race guard (pre-existing row): see the user-groups counterpart above.
test('createCategory returns false on a pre-existing slug without throwing', async () => {
	const { db } = await setup();

	expect(await createCategory(db, sampleCategory('announcements'))).toBe(true);

	const second = await createCategory(db, sampleCategory('announcements'));

	expect(second).toBe(false);
	expect(await countCategoryRows(db, 'announcements')).toBe(1);
});

// Concurrent duplicate for categories: see the user-groups counterpart above.
test('createCategory parallel duplicate calls produce exactly one row', async () => {
	const { db } = await setup();

	const [a, b] = await Promise.all([
		createCategory(db, sampleCategory('announcements')),
		createCategory(db, sampleCategory('announcements'))
	]);

	expect([a, b].filter((v) => v === true)).toHaveLength(1);
	expect([a, b].filter((v) => v === false)).toHaveLength(1);
	expect(await countCategoryRows(db, 'announcements')).toBe(1);
});
