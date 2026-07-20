// DAO for the per-user editor-preferences table. Mirrors the
// notificationPreferences access pattern: a missing row resolves to the code
// defaults, and writes are a single atomic ON CONFLICT DO UPDATE so two
// concurrent requests from the same user (double-click, retry storm) cannot
// race past the existence check and surface the userId PK violation as a
// 500.

import { editorPreferences } from '../schema';
import { eq } from 'drizzle-orm';
import type { D1Db } from '../index';
import { DEFAULT_EDITOR_PREFERENCES, type EditorPreferences } from '$lib/editor/prefs';

/**
 * Read a user's editor preferences, falling back to the defaults when no row
 * exists yet (fresh account, or the user never customized). Always returns a
 * complete EditorPreferences object - never partial.
 */
export async function getEditorPreferences(db: D1Db, userId: number): Promise<EditorPreferences> {
	const rows = await db
		.select()
		.from(editorPreferences)
		.where(eq(editorPreferences.userId, userId))
		.limit(1);

	if (rows.length === 0) {
		return { ...DEFAULT_EDITOR_PREFERENCES };
	}

	const row = rows[0];
	return {
		plainMode: row.plainMode,
		bold: row.bold,
		italic: row.italic,
		underline: row.underline,
		strikethrough: row.strikethrough,
		highlight: row.highlight,
		spoiler: row.spoiler,
		headings: row.headings,
		quote: row.quote,
		codeBlock: row.codeBlock,
		bulletList: row.bulletList,
		numberedList: row.numberedList,
		checklist: row.checklist,
		link: row.link,
		autolink: row.autolink,
		image: row.image,
		markdown: row.markdown
	};
}

/**
 * Insert or update the user's editor preferences. `updates` carries only the
 * fields being changed; unspecified fields keep their existing value (or the
 * column default on first insert). The single statement races safely on the
 * userId primary key: a concurrent first-write wins, and any follower folds
 * its `updates` onto the surviving row instead of raising a PK violation.
 */
export async function upsertEditorPreferences(
	db: D1Db,
	userId: number,
	updates: Partial<EditorPreferences>
): Promise<void> {
	await db
		.insert(editorPreferences)
		.values({ userId, ...updates })
		.onConflictDoUpdate({
			target: editorPreferences.userId,
			set: updates
		});
}
