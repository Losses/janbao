// DAO for the per-user interface-preferences table. Mirrors the
// editorPreferences access pattern: a missing row resolves to the code
// defaults, and writes are a single atomic ON CONFLICT DO UPDATE so two
// concurrent requests from the same user (double-click, retry storm) cannot
// race past the existence check and surface the userId PK violation as a
// 500.

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
 * the column default on first insert). The single statement races safely on
 * the userId primary key: a concurrent first-write wins, and any follower
 * folds its `updates` onto the surviving row instead of raising a PK violation.
 */
export async function upsertUiPreferences(
	db: D1Db,
	userId: number,
	updates: Partial<UiPreferences>
): Promise<void> {
	await db
		.insert(uiPreferences)
		.values({ userId, ...updates })
		.onConflictDoUpdate({
			target: uiPreferences.userId,
			set: updates
		});
}
