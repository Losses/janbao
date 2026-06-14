import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import { ensureFtsSchema } from '../search/fts-schema';

// Production: Cloudflare D1 database client
export const getDb = (d1: D1Database) => drizzle(d1, { schema });

// Type alias for D1-backed Drizzle instance (used as the canonical database type)
export type D1Db = ReturnType<typeof getDb>;

/**
 * Transaction callback parameter type - inferred from D1Db transaction overload.
 */
export type DbTransaction = Parameters<Parameters<D1Db['transaction']>[0]>[0];

// Cached local development database instance
let _localDb: D1Db | null = null;

/**
 * Type bridge for database driver abstraction boundaries.
 * Both D1 and better-sqlite3 drivers share the same Drizzle query API;
 * all operations are awaited, normalizing sync/async return types.
 */
function castDb<T>(value: unknown): T {
	return value as T;
}

/**
 * Create or return cached local development database (libsql).
 * Auto-applies pending migrations on first call.
 * Uses dynamic imports to avoid bundling in Cloudflare production builds.
 *
 * Uses libsql because it provides an async SQLite API compatible with D1's
 * transaction pattern (db.transaction(async (tx) => { ... })).
 * Sync drivers (better-sqlite3, bun:sqlite) do not support async callbacks.
 */
export async function getLocalDb(): Promise<D1Db> {
	if (!_localDb) {
		const { createClient } = await import('@libsql/client');
		const { drizzle: drizzleLibsql } = await import('drizzle-orm/libsql');
		const { migrate } = await import('drizzle-orm/libsql/migrator');

		const client = createClient({ url: 'file:.local.db' });
		// WAL allows concurrent readers (dev server) alongside a writer (import scripts),
		// so running import-data without stopping `bun run dev` no longer 500s on lock
		// errors. busy_timeout makes a contended writer wait briefly instead of failing.
		await client.execute('PRAGMA journal_mode=WAL');
		await client.execute('PRAGMA busy_timeout=5000');
		const sqliteDb = drizzleLibsql(client, { schema });
		await migrate(sqliteDb, { migrationsFolder: 'drizzle/local-migrations' });
		// Create FTS5 trigram search tables (contentless). Drizzle cannot model
		// virtual tables, so these live outside the migration journal and are
		// applied idempotently here (local) and via the admin endpoint (production).
		await ensureFtsSchema(castDb<D1Db>(sqliteDb));
		_localDb = castDb<D1Db>(sqliteDb);
	}
	return _localDb;
}
