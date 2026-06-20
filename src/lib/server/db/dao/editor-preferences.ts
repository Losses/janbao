// DAO for the per-user editor-preferences table. Mirrors the
// notificationPreferences access pattern: a missing row resolves to the code
// defaults, and writes are an explicit select-then-insert/update (D1/libsql
// does not need an atomic upsert here - the row is keyed by userId and only the
// owning user writes it).

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
 * column default on first insert). Mirrors the profile/preferences handler's
 * select-then-insert/update so the write path matches the rest of the codebase.
 */
export async function upsertEditorPreferences(
	db: D1Db,
	userId: number,
	updates: Partial<EditorPreferences>
): Promise<void> {
	const existing = await db
		.select({ userId: editorPreferences.userId })
		.from(editorPreferences)
		.where(eq(editorPreferences.userId, userId))
		.limit(1);

	if (existing.length === 0) {
		await db.insert(editorPreferences).values({ userId, ...updates });
	} else {
		await db.update(editorPreferences).set(updates).where(eq(editorPreferences.userId, userId));
	}
}
