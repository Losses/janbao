import { test, expect } from 'bun:test';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../schema';
import { userGroups, users, uiPreferences, editorPreferences } from '../schema';
import type { D1Db } from '../index';
import { upsertUiPreferences } from './ui-preferences';
import { upsertEditorPreferences } from './editor-preferences';

// Drizzle's libsql driver is structurally compatible with the D1 driver for the
// queries these DAOs issue; bridge the types the same way db/index.ts does.
function castDb<T>(value: unknown): T {
	return value as T;
}

interface TestDb {
	db: D1Db;
	client: Client;
}

const GROUP_SLUG = 'test-group';

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
	return { db, client };
}

async function countUiRows(db: D1Db, userId: number): Promise<number> {
	const rows = await db
		.select({ userId: uiPreferences.userId })
		.from(uiPreferences)
		.where(eq(uiPreferences.userId, userId));
	return rows.length;
}

async function countEditorRows(db: D1Db, userId: number): Promise<number> {
	const rows = await db
		.select({ userId: editorPreferences.userId })
		.from(editorPreferences)
		.where(eq(editorPreferences.userId, userId));
	return rows.length;
}

// The contract of an atomic upsert: calling on a fresh userId inserts exactly
// one row, and calling again with different fields updates that row in place
// rather than creating a second row or surfacing the PK violation.
test('upsertUiPreferences inserts then updates the same row', async () => {
	const { db } = await setup();

	await upsertUiPreferences(db, 1, { interfaceTheme: 'dark', blockPostTheme: false });
	expect(await countUiRows(db, 1)).toBe(1);

	await upsertUiPreferences(db, 1, { interfaceTheme: 'light' });
	expect(await countUiRows(db, 1)).toBe(1);

	const rows = await db.select().from(uiPreferences).where(eq(uiPreferences.userId, 1));
	// Second call only overwrote interfaceTheme; blockPostTheme (unchanged in
	// the second call) is preserved.
	expect(rows[0].interfaceTheme).toBe('light');
	expect(rows[0].blockPostTheme).toBe(false);
});

// Race guard: simulate a concurrent insert that lands just before this
// caller's upsert. The atomic ON CONFLICT DO UPDATE must fold onto the
// surviving row rather than raise a PK violation.
test('upsertUiPreferences folds onto a pre-existing row without throwing', async () => {
	const { db } = await setup();

	await db.insert(uiPreferences).values({ userId: 1, interfaceTheme: 'dark' }).run();
	await upsertUiPreferences(db, 1, { interfaceTheme: 'light' });

	expect(await countUiRows(db, 1)).toBe(1);
	const rows = await db.select().from(uiPreferences).where(eq(uiPreferences.userId, 1));
	expect(rows[0].interfaceTheme).toBe('light');
});

test('upsertEditorPreferences inserts then updates the same row', async () => {
	const { db } = await setup();

	await upsertEditorPreferences(db, 1, { bold: false, italic: false });
	expect(await countEditorRows(db, 1)).toBe(1);

	await upsertEditorPreferences(db, 1, { bold: true });
	expect(await countEditorRows(db, 1)).toBe(1);

	const rows = await db.select().from(editorPreferences).where(eq(editorPreferences.userId, 1));
	// bold overwritten; italic (absent from the second call) preserved.
	expect(rows[0].bold).toBe(true);
	expect(rows[0].italic).toBe(false);
});

test('upsertEditorPreferences folds onto a pre-existing row without throwing', async () => {
	const { db } = await setup();

	await db.insert(editorPreferences).values({ userId: 1, bold: false }).run();
	await upsertEditorPreferences(db, 1, { italic: false });

	expect(await countEditorRows(db, 1)).toBe(1);
	const rows = await db.select().from(editorPreferences).where(eq(editorPreferences.userId, 1));
	expect(rows[0].bold).toBe(false);
	expect(rows[0].italic).toBe(false);
});
