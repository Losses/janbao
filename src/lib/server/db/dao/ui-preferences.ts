// DAO for the per-user interface-preferences table. Mirrors the
// editorPreferences access pattern: a missing row resolves to the code
// defaults, and writes are an explicit select-then-insert/update (D1/libsql
// does not need an atomic upsert here - the row is keyed by userId and only
// the owning user writes it).

import { uiPreferences } from '../schema';
import { eq } from 'drizzle-orm';
import type { D1Db } from '../index';
import { DEFAULT_UI_PREFERENCES, type UiPreferences } from '$lib/ui/prefs';

/**
 * Read a user's interface preferences, falling back to the defaults when no
 * row exists yet (fresh account, or the user never customized). Always returns
 * a complete UiPreferences object - never partial.
 */
export async function getUiPreferences(db: D1Db, userId: number): Promise<UiPreferences> {
	const rows = await db
		.select()
		.from(uiPreferences)
		.where(eq(uiPreferences.userId, userId))
		.limit(1);

	if (rows.length === 0) {
		return { ...DEFAULT_UI_PREFERENCES };
	}

	const row = rows[0];
	return {
		interfaceTheme: row.interfaceTheme ?? '',
		blockPostTheme: row.blockPostTheme
	};
}

/**
 * Insert or update the user's interface preferences. `updates` carries only
 * the fields being changed; unspecified fields keep their existing value (or
 * the column default on first insert). Mirrors the editorPreferences handler's
 * select-then-insert/update so the write path matches the rest of the codebase.
 */
export async function upsertUiPreferences(
	db: D1Db,
	userId: number,
	updates: Partial<UiPreferences>
): Promise<void> {
	const existing = await db
		.select({ userId: uiPreferences.userId })
		.from(uiPreferences)
		.where(eq(uiPreferences.userId, userId))
		.limit(1);

	if (existing.length === 0) {
		await db.insert(uiPreferences).values({ userId, ...updates });
	} else {
		await db.update(uiPreferences).set(updates).where(eq(uiPreferences.userId, userId));
	}
}
