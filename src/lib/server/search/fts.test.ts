import { test, expect } from 'bun:test';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../db/schema';
import type { D1Db } from '../db';
import type { VoidHandler } from '$lib/types/handlers';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	indexReply,
	unindexReply,
	reindexReply,
	indexUser,
	reindexUser,
	indexDiscussionTitle,
	unindexDiscussion
} from './fts';

// Drizzle's libsql driver is structurally compatible with the D1 driver for the
// `.run(sql)` API this module uses; bridge the types the same way db/index.ts does.
function castDb<T>(value: unknown): T {
	return value as T;
}

interface FtsSetup {
	db: D1Db;
	client: Client;
}

async function setup(): Promise<FtsSetup> {
	const client = createClient({ url: ':memory:' });
	await client.execute(
		`CREATE VIRTUAL TABLE replies_fts USING fts5(body, content='', tokenize='trigram')`
	);
	const db = castDb<D1Db>(drizzle(client, { schema }));
	return { db, client };
}

async function matchCount(client: Client, term: string): Promise<number> {
	const res = await client.execute({
		sql: 'SELECT count(*) AS c FROM replies_fts WHERE replies_fts MATCH ?',
		args: [term]
	});
	const row = res.rows[0];
	// libsql Row has a string index signature; 'c' is the count column.
	return row ? Number(row.c) : 0;
}

const lexical = (text: string): string =>
	JSON.stringify({
		root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text }] }] }
	});

test('indexReply makes content searchable', async () => {
	const { db, client } = await setup();
	await indexReply(db, 1, lexical('全文检索测试'));
	expect(await matchCount(client, '全文检索')).toBe(1);
	expect(await matchCount(client, '检索测试')).toBe(1);
});

test('unindexReply removes the row when given the same content it was indexed with', async () => {
	const { db, client } = await setup();
	const content = lexical('可被删除的内容');
	await indexReply(db, 1, content);
	expect(await matchCount(client, '被删除')).toBe(1);
	await unindexReply(db, 1, content);
	expect(await matchCount(client, '被删除')).toBe(0);
});

test('reindexReply swaps old terms for new', async () => {
	const { db, client } = await setup();
	const oldContent = lexical('旧的检索内容');
	const newContent = lexical('全新的搜索内容');
	await indexReply(db, 1, oldContent);
	expect(await matchCount(client, '旧的检索')).toBe(1);

	await reindexReply(db, 1, oldContent, newContent);
	expect(await matchCount(client, '旧的检索')).toBe(0);
	expect(await matchCount(client, '全新的搜索')).toBe(1);
});

test('reindexReply is a no-op on searchability when old === new content', async () => {
	const { db, client } = await setup();
	const content = lexical('不变的内容');
	await indexReply(db, 1, content);
	await reindexReply(db, 1, content, content);
	expect(await matchCount(client, '不变的')).toBe(1);
});

test('distinct rowids are independent rows', async () => {
	const { db, client } = await setup();
	await indexReply(db, 1, lexical('第一条回复'));
	await indexReply(db, 2, lexical('第二条回复'));
	expect(await matchCount(client, '第一条')).toBe(1);
	expect(await matchCount(client, '第二条')).toBe(1);
	expect(await matchCount(client, '条回复')).toBe(2);
});

// ---------------------------------------------------------------------------
// Transaction atomicity contract.
//
// The fix in src/routes/api/profile/edit/+server.ts and the deleteDiscussion
// action relies on the FTS helpers participating in the caller's transaction:
// if the tx rolls back, the FTS write must roll back too. A regression that
// moves a reindex/unindex outside the tx would let the FTS change commit
// independently of the source row UPDATE, leaving a stale or ghost index.
// These tests pin the contract by mutating FTS inside a thrown tx and
// asserting nothing persisted.
// ---------------------------------------------------------------------------

interface MultiTableSetup {
	db: D1Db;
	client: Client;
	cleanup: VoidHandler;
}

// db.transaction() opens a pooled connection, which under libsql's `:memory:`
// URL is a *separate* private in-memory database (so tables created on the
// outer client are invisible inside the tx). A temp file gives every test a
// real on-disk SQLite database that both the outer client and the tx see
// consistently; the per-test dir is removed in cleanup.
let multiTableSeq = 0;
async function setupMultiTable(): Promise<MultiTableSetup> {
	multiTableSeq += 1;
	const dir = mkdtempSync(join(tmpdir(), `fts-tx-${process.pid}-${multiTableSeq}-`));
	const cleanup = () => {
		rmSync(dir, { recursive: true, force: true });
	};
	const client = createClient({ url: `file:${join(dir, 'test.db')}` });
	await client.execute(
		`CREATE VIRTUAL TABLE replies_fts USING fts5(body, content='', tokenize='trigram')`
	);
	await client.execute(
		`CREATE VIRTUAL TABLE users_fts USING fts5(username, displayName, bio, content='', tokenize='trigram')`
	);
	await client.execute(
		`CREATE VIRTUAL TABLE discussions_fts USING fts5(title, content='', tokenize='trigram')`
	);
	const db = castDb<D1Db>(drizzle(client, { schema }));
	return { db, client, cleanup };
}

async function usersFtsMatchCount(client: Client, term: string): Promise<number> {
	const res = await client.execute({
		sql: 'SELECT count(*) AS c FROM users_fts WHERE users_fts MATCH ?',
		args: [term]
	});
	const row = res.rows[0];
	return row ? Number(row.c) : 0;
}

async function discussionsFtsMatchCount(client: Client, term: string): Promise<number> {
	const res = await client.execute({
		sql: 'SELECT count(*) AS c FROM discussions_fts WHERE discussions_fts MATCH ?',
		args: [term]
	});
	const row = res.rows[0];
	return row ? Number(row.c) : 0;
}

test('reindexUser inside a rolled-back transaction leaves the prior FTS row intact', async () => {
	const { db, client, cleanup } = await setupMultiTable();
	try {
		await indexUser(db, 1, 'alice', 'Alice', '');
		expect(await usersFtsMatchCount(client, 'alice')).toBe(1);

		await expect(
			db.transaction(async (tx) => {
				await reindexUser(tx, 1, 'alice', 'Alice', '', 'bob', 'Bob', '');
				throw new Error('simulate post-UPDATE failure');
			})
		).rejects.toThrow('simulate post-UPDATE failure');

		// Atomicity: the rolled-back tx must leave the prior FTS row in place -
		// 'alice' still searchable, 'bob' never committed.
		expect(await usersFtsMatchCount(client, 'alice')).toBe(1);
		expect(await usersFtsMatchCount(client, 'bob')).toBe(0);
	} finally {
		cleanup();
	}
});

test('reindexUser inside a committed transaction swaps the indexed terms', async () => {
	const { db, client, cleanup } = await setupMultiTable();
	try {
		await indexUser(db, 1, 'alice', 'Alice', '');

		await db.transaction(async (tx) => {
			await reindexUser(tx, 1, 'alice', 'Alice', '', 'bob', 'Bob', '');
		});

		expect(await usersFtsMatchCount(client, 'alice')).toBe(0);
		expect(await usersFtsMatchCount(client, 'bob')).toBe(1);
	} finally {
		cleanup();
	}
});

test('unindexDiscussion inside a rolled-back transaction leaves the title searchable', async () => {
	const { db, client, cleanup } = await setupMultiTable();
	try {
		await indexDiscussionTitle(db, 7, 'hello world');
		expect(await discussionsFtsMatchCount(client, 'hello')).toBe(1);

		await expect(
			db.transaction(async (tx) => {
				await unindexDiscussion(tx, 7, 'hello world');
				throw new Error('simulate post-UPDATE failure');
			})
		).rejects.toThrow('simulate post-UPDATE failure');

		// Atomicity: the unindex rolled back, so the title is still searchable.
		// This is the invariant deleteDiscussion relies on for "all-or-nothing"
		// between the soft-delete UPDATE and the FTS cleanup.
		expect(await discussionsFtsMatchCount(client, 'hello')).toBe(1);
	} finally {
		cleanup();
	}
});
