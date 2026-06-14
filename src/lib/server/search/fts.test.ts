import { test, expect } from 'bun:test';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../db/schema';
import type { D1Db } from '../db';
import { indexReply, unindexReply, reindexReply } from './fts';

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
