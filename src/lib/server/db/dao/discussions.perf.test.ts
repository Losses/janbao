import { test, expect, describe } from 'bun:test';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '../schema';
import {
	categories,
	categoryPermissions,
	discussionReads,
	discussions,
	replies,
	userGroups,
	users
} from '../schema';
import type { D1Db } from '../index';
import { getDiscussionsList, getDiscussionsCount, loadDiscussionsPage } from './discussions';

// Drizzle's libsql driver is structurally compatible with the D1 driver for the
// queries discussions.ts issues; bridge the types the same way db/index.ts does.
function castDb<T>(value: unknown): T {
	return value as T;
}

type MigratableDb = Parameters<typeof migrate>[0];

// A captured SQL statement: the compiled text plus bound args, so we can later
// run EXPLAIN QUERY PLAN against the exact statement the DAO issued.
interface CapturedStatement {
	sql: string;
	args: unknown[];
}

interface CountingState {
	roundTrips: number;
	statements: CapturedStatement[];
}

type ResetFn = () => void;

interface CountingClient {
	client: Client;
	state: CountingState;
	reset: ResetFn;
}

// Loosely-typed execute argument shape Drizzle hands libsql.
interface ExecuteArg {
	sql?: string;
	args?: unknown[];
}

// Any callable held on the underlying client we may need to bind.
type AnyFn = (...args: never[]) => unknown;

// Wrap a libsql client in a Proxy that tallies every execute()/batch() the
// Drizzle driver issues. Round-trip count is the headline cost on D1 (each query
// is an RPC), so this is the metric that surfaces the bottleneck. We also keep
// the statement text + args so EXPLAIN QUERY PLAN can replay the real plan.
function makeCountingClient(url: string): CountingClient {
	const real = createClient({ url });
	const state: CountingState = { roundTrips: 0, statements: [] };
	const capture = (stmt: unknown): void => {
		if (typeof stmt === 'string') {
			state.statements.push({ sql: stmt, args: [] });
			return;
		}
		if (stmt && typeof stmt === 'object') {
			const s = stmt as ExecuteArg;
			if (s.sql) state.statements.push({ sql: s.sql, args: s.args ?? [] });
		}
	};
	const client = new Proxy(real, {
		get(_: Client, prop: string | symbol): unknown {
			if (prop === 'execute') {
				return async (stmt: unknown): Promise<unknown> => {
					state.roundTrips++;
					capture(stmt);
					return real.execute(stmt as never);
				};
			}
			if (prop === 'batch') {
				return async (stmts: unknown[], opts?: unknown): Promise<unknown> => {
					state.roundTrips += Array.isArray(stmts) ? stmts.length : 1;
					if (Array.isArray(stmts)) for (const s of stmts) capture(s);
					return real.batch(stmts as never, opts as never);
				};
			}
			const value = Reflect.get(real, prop);
			return typeof value === 'function' ? (value as AnyFn).bind(real) : value;
		}
	});
	const reset: ResetFn = () => {
		state.roundTrips = 0;
		state.statements = [];
	};
	return { client, state, reset };
}

const NUM_DISCUSSIONS = 800;
const REPLIES_PER = 20;
const PAGE_LIMIT = 20;
const NUM_CATEGORIES = 8;
const READER_ID = 2;
const AUTHOR_ID = 1;

// Epoch base (seconds) for deterministic timestamps. We only need strictly
// ascending lastReplyAt/createdAt per thread; the absolute value is irrelevant.
const BASE_SEC = 1_700_000_000;

interface SeedReply {
	id: number;
	discussionId: number;
	authorId: number;
	contentJson: string;
	createdAt: Date;
}

interface SeedDiscussion {
	id: number;
	title: string;
	slug: string;
	categorySlug: string;
	authorId: number;
	commentCount: number;
	createdAt: Date;
	lastReplyAt: Date;
	isPinned: boolean;
}

interface SeedRead {
	userId: number;
	discussionId: number;
	lastReadAt: Date;
	lastReadPage: number;
	lastReadReplyId: number;
}

interface PerfFixture {
	db: D1Db;
	harness: CountingClient;
	pageOneIds: number[];
}

// Inclusive integer range [start, end].
function inclusiveRange(start: number, end: number): number[] {
	const out: number[] = [];
	for (let i = start; i <= end; i++) out.push(i);
	return out;
}

async function setupPerf(): Promise<PerfFixture> {
	const harness = makeCountingClient(':memory:');
	const db = castDb<D1Db>(drizzle(harness.client, { schema }));
	await migrate(castDb<MigratableDb>(db), { migrationsFolder: 'drizzle/local-migrations' });

	// Groups: member (reader/author) + admin.
	await db
		.insert(userGroups)
		.values([
			{ slug: 'member', title: 'Member', description: 'd' },
			{ slug: 'admin', title: 'Admin', description: 'd' }
		])
		.run();

	// Author + reader.
	await db
		.insert(users)
		.values([
			{
				id: AUTHOR_ID,
				username: 'author',
				email: 'author@x',
				passwordHash: 'h',
				displayName: 'Author',
				groupSlug: 'member'
			},
			{
				id: READER_ID,
				username: 'reader',
				email: 'reader@x',
				passwordHash: 'h',
				displayName: 'Reader',
				groupSlug: 'member'
			}
		])
		.run();

	// Categories + member read/create permission on each.
	const catRows = Array.from({ length: NUM_CATEGORIES }, (_, c) => {
		const slug = `cat-${c}`;
		return { slug, title: slug, description: 'd' };
	});
	await db.insert(categories).values(catRows).run();
	await db
		.insert(categoryPermissions)
		.values(
			catRows.map((c) => ({
				categorySlug: c.slug,
				groupSlug: 'member',
				canRead: true,
				canCreate: true,
				canUpdate: false,
				canDelete: false
			}))
		)
		.run();

	// Discussions: lastReplyAt strictly ascending with id, so the page-1 window
	// (ORDER BY isPinned DESC, lastReplyAt DESC, id DESC) is the highest ids.
	const discRows: SeedDiscussion[] = Array.from({ length: NUM_DISCUSSIONS }, (_, i) => {
		const id = i + 1;
		const created = BASE_SEC + id;
		return {
			id,
			title: `thread-${id}`,
			slug: `thread-${id}`,
			categorySlug: `cat-${id % NUM_CATEGORIES}`,
			authorId: AUTHOR_ID,
			commentCount: REPLIES_PER,
			createdAt: new Date(created * 1000),
			lastReplyAt: new Date((created + REPLIES_PER) * 1000),
			isPinned: id === NUM_DISCUSSIONS // pin the newest so it sorts first regardless
		};
	});
	await db.insert(discussions).values(discRows).run();

	// Replies in chunked multi-row inserts (one statement per chunk, not per row).
	const replyChunkSize = 800;
	const replyBuffer: SeedReply[] = [];
	const flush = async (): Promise<void> => {
		if (replyBuffer.length === 0) return;
		await db.insert(replies).values(replyBuffer.splice(0)).run();
	};
	for (let id = 1; id <= NUM_DISCUSSIONS; id++) {
		const created = BASE_SEC + id;
		for (let r = 1; r <= REPLIES_PER; r++) {
			replyBuffer.push({
				id: id * 1000 + r,
				discussionId: id,
				authorId: AUTHOR_ID,
				contentJson: '{}',
				createdAt: new Date((created + r) * 1000)
			});
			if (replyBuffer.length >= replyChunkSize) await flush();
		}
	}
	await flush();

	// Page-1 window = pinned first, then newest by id. Pinned is NUM_DISCUSSIONS;
	// the next PAGE_LIMIT-1 are ids [N-(PAGE_LIMIT-1) .. N-1].
	const pageOneIds = [
		NUM_DISCUSSIONS,
		...inclusiveRange(NUM_DISCUSSIONS - (PAGE_LIMIT - 1), NUM_DISCUSSIONS - 1)
	];

	// Reader has read-history on half the page-1 threads, midway through the
	// replies, so the unread-count batch query has work to do (unread > 0) while
	// the other half falls back to commentCount (never opened). Pick every other
	// id by parity so the read/unread split is deterministic.
	const readRows: SeedRead[] = pageOneIds
		.filter((did) => did % 2 === 1)
		.map((did) => ({
			userId: READER_ID,
			discussionId: did,
			lastReadAt: new Date((BASE_SEC + did + 5) * 1000),
			lastReadPage: 1,
			lastReadReplyId: did * 1000 + 10 // read up to reply #10 → 10 unread remain
		}));
	if (readRows.length > 0) {
		await db.insert(discussionReads).values(readRows).run();
	}

	// A fresh :memory: database has empty planner stats (sqlite_stat1 is blank),
	// so SQLite falls back to row-count heuristics. Production D1 maintains index
	// statistics, so ANALYZE here makes the EXPLAIN plans representative of prod
	// rather than of an un-analyzed dev DB.
	await harness.client.execute('ANALYZE');

	// Reset counters so the fixture's own seeding doesn't pollute the benchmark.
	harness.reset();
	return { db, harness, pageOneIds };
}

async function explain(harness: CountingClient, stmt: CapturedStatement): Promise<string[]> {
	// Best-effort: some libsql backends reject EXPLAIN in the object-execute
	// form. The captured SQL + plan is diagnostic, not load-bearing, so swallow
	// planner errors and report them inline instead of failing the test.
	try {
		const res = await harness.client.execute({
			sql: 'EXPLAIN QUERY PLAN ' + stmt.sql,
			args: stmt.args as never
		});
		return res.rows.map((r) => Object.values(r).join(' '));
	} catch (err) {
		return [`(explain unavailable: ${(err as Error).message})`];
	}
}

function summarize(label: string, statements: CapturedStatement[]): string {
	const compact = statements.map((s, i) => {
		const oneLine = s.sql.replace(/\s+/g, ' ').trim();
		const ellipsized = oneLine.length > 110 ? oneLine.slice(0, 107) + '...' : oneLine;
		return `  [${i + 1}] ${ellipsized}  ·  ${s.args.length} args`;
	});
	return `\n${label}:\n${compact.join('\n')}`;
}

describe('discussion list performance baseline', () => {
	test('loadDiscussionsPage (logged-in reader) - round-trips, timing, plan', async () => {
		const { db, harness, pageOneIds } = await setupPerf();

		harness.reset();
		const start = performance.now();
		const result = await loadDiscussionsPage(db, {
			userId: READER_ID,
			limit: PAGE_LIMIT,
			offset: 0,
			groupSlug: 'member'
		});
		const elapsedMs = performance.now() - start;

		console.log(
			`\n[loadDiscussionsPage reader] ${harness.state.roundTrips} SQL round-trips in ${elapsedMs.toFixed(2)}ms`
		);
		console.log(summarize('statements', harness.state.statements));

		// Correctness gates (these must hold before AND after optimization).
		expect(result.discussions).toHaveLength(PAGE_LIMIT);
		expect(result.totalCount).toBe(NUM_DISCUSSIONS);
		expect(result.totalPages).toBe(Math.ceil(NUM_DISCUSSIONS / PAGE_LIMIT));
		// Pinned thread sorts to the very top.
		expect(result.discussions[0].id).toBe(NUM_DISCUSSIONS);
		// Last-reply author is populated for every row.
		for (const d of result.discussions) {
			expect(d.lastReplyAuthorId).toBe(AUTHOR_ID);
		}
		// Read threads (reader opened midway) have exactly 10 unread; unopened
		// threads fall back to commentCount (REPLIES_PER). readRows targeted odd ids.
		const byId = new Map(result.discussions.map((d) => [d.id, d]));
		for (const did of pageOneIds) {
			const d = byId.get(did)!;
			const wasRead = did % 2 === 1;
			expect(d.unreadCount).toBe(wasRead ? 10 : REPLIES_PER);
		}

		// Snapshot the round-trip count NOW: the EXPLAIN loop below routes through
		// the counting client and would inflate it. The pre-loop value is the real
		// per-page-load cost.
		const roundTrips = harness.state.roundTrips;

		// EXPLAIN each captured statement so we can see whether the planner scans
		// or uses an index. This is the part that pinpoints the slow query. Snapshot
		// first: explain() routes through the counting client and would otherwise
		// append each EXPLAIN to state.statements, growing the array under iteration.
		const planSnapshot = [...harness.state.statements];
		for (const stmt of planSnapshot) {
			const plan = await explain(harness, stmt);
			const head = stmt.sql.replace(/\s+/g, ' ').slice(0, 80);
			console.log(`\n  PLAN: ${head}\n    ${plan.join('\n    ')}`);
		}

		// Regression guard for the homepage-sort index: the main list query must
		// walk discussions_pinned_last_reply_idx in ORDER BY order and NOT materialize
		// a temp B-tree sort over the whole non-deleted set on every page load. This
		// relies on ANALYZE stats (run in setupPerf); production D1 maintains them.
		const mainListStmt = planSnapshot.find(
			(s) => /from ["`]discussions["`]/i.test(s.sql) && /order by/i.test(s.sql)
		);
		expect(mainListStmt).toBeDefined();
		if (mainListStmt) {
			const mainPlan = (await explain(harness, mainListStmt)).join('\n');
			expect(mainPlan).toContain('discussions_pinned_last_reply_idx');
			expect(mainPlan).not.toMatch(/USE TEMP B-TREE FOR ORDER BY/);
		}

		// Headline regression guard: a page load should stay within a small number
		// of SQL round-trips. (Reader path is ~6; this caps drift.)
		expect(roundTrips).toBeLessThanOrEqual(7);
	});

	test('loadDiscussionsPage (guest) - round-trips', async () => {
		const { db, harness } = await setupPerf();

		harness.reset();
		const start = performance.now();
		const result = await loadDiscussionsPage(db, {
			userId: null,
			limit: PAGE_LIMIT,
			offset: 0,
			groupSlug: 'guest'
		});
		const elapsedMs = performance.now() - start;
		console.log(
			`\n[loadDiscussionsPage guest] ${harness.state.roundTrips} SQL round-trips in ${elapsedMs.toFixed(2)}ms`
		);
		console.log(summarize('statements', harness.state.statements));

		expect(result.discussions).toHaveLength(PAGE_LIMIT);
		// Guest has no read history, so unread counting is skipped entirely
		// (unreadMap is only populated for a logged-in user); every row reports 0.
		// The page renders commentCount for guests, not unreadCount.
		for (const d of result.discussions) {
			expect(d.unreadCount).toBe(0);
			expect(d.isBookmarked).toBe(false);
		}
		expect(harness.state.roundTrips).toBeLessThanOrEqual(7);
	});

	test('no per-row OR blow-up in the replies enrichment queries', async () => {
		const { db, harness } = await setupPerf();

		harness.reset();
		await getDiscussionsList(db, {
			userId: READER_ID,
			limit: PAGE_LIMIT,
			offset: 0,
			groupSlug: 'member'
		});

		// Statements that read `replies` (lastReplyAuthor + unread enrichment).
		const replyStmts = harness.state.statements.filter((s) => /from ["`]replies["`]/i.test(s.sql));
		// The OR-clause form emits one `OR` conjunction per discussion on the page.
		// A window-function rewrite drops that to zero OR conjunctions.
		const orCounts = replyStmts.map((s) => (s.sql.match(/\bOR\b/gi) ?? []).length);
		console.log(
			`\n[replies enrichment] reply-statement OR conjunction counts: ${JSON.stringify(orCounts)}`
		);

		// Correctness sanity: at least one replies-touching enrichment statement ran.
		expect(replyStmts.length).toBeGreaterThan(0);

		// Regression guard for the lastReplyAuthor query: it must resolve via the
		// (discussion_id, created_at) index - a page-sized set of cheap seeks - and
		// NOT scan all non-deleted replies. A ROW_NUMBER() window rewrite looked
		// cleaner but made the planner scan replies_deleted_idx + sort every reply,
		// so the per-discussion match on the denormalized lastReplyAt stays.
		const lastReplyStmt = replyStmts.find((s) => /join ["`]users["`]/i.test(s.sql));
		expect(lastReplyStmt).toBeDefined();
		if (lastReplyStmt) {
			const plan = (await explain(harness, lastReplyStmt)).join('\n');
			console.log(`\n  lastReplyAuthor PLAN:\n    ${plan.split('\n').join('\n    ')}`);
			expect(plan).toContain('replies_discussion_created_idx');
			expect(plan).not.toMatch(/SCAN "replies"/);
		}
	});

	test('list count and list query agree on read-access scoping (no pagination drift)', async () => {
		const { db } = await setupPerf();

		const list = await getDiscussionsList(db, {
			userId: null,
			limit: PAGE_LIMIT,
			offset: 0,
			groupSlug: 'member'
		});
		const total = await getDiscussionsCount(db, { groupSlug: 'member' });

		// The list must return a full page when the readable set is larger than a
		// page. If the list filters client-side (post-query) while the count filters
		// server-side, a full page can come back short → pagination drift.
		expect(list.length).toBe(PAGE_LIMIT);
		expect(total).toBe(NUM_DISCUSSIONS);
	});
});
