import { eq, inArray } from 'drizzle-orm';
import { users } from '../schema';
import type { D1Db } from '../index';
import { isRealUserId } from '$lib/utils/user';
import { buildAvatarUrl } from '$lib/utils/image';
import type { UserPreview } from '$lib/types/api';

/** Maximum users fetched in one batched preview lookup (guards fan-out). */
const MAX_USER_BATCH = 500;

/**
 * Raw user-display column set for any JOINed select that needs to derive a
 * server-built avatar URL. Spread into db.select({...}) for JOINs (single
 * query, no N+1). All columns reference the `users` table, which drizzle's
 * nested-select typing requires. Callers then compute `avatarUrl` server-side
 * via `buildAvatarUrl(id, avatarFileId, avatarContentType)` and return a
 * `UserPreview`; the raw avatar columns are NEVER shipped to the client.
 */
export const userPreviewColumns = {
	id: users.id,
	username: users.username,
	displayName: users.displayName,
	avatarFileId: users.avatarFileId,
	avatarContentType: users.avatarContentType
};

/**
 * Author-display columns (users table) with the `author*` alias prefix, for
 * spreading into any query that JOINs users as the author of a row (discussion
 * author, reply author, activity actor, message author, …). Mirrors
 * AuthorPreviewFields in $lib/types/api - add a field in both places and every
 * author-bearing query + type picks it up automatically. `authorId` itself is
 * NOT here (it comes from the parent table, e.g. discussions.authorId, so its
 * source varies per query).
 */
export const authorPreviewColumns = {
	authorDisplayName: users.displayName,
	authorUsername: users.username,
	authorAvatarFileId: users.avatarFileId,
	authorAvatarContentType: users.avatarContentType
};

// Raw row shape returned by db.select(userPreviewColumns) - intermediary so the
// URL is built once, server-side, before the value reaches the API boundary.
interface UserPreviewRow {
	id: number;
	username: string;
	displayName: string;
	avatarFileId: string | null;
	avatarContentType: string | null;
}

function toUserPreview(r: UserPreviewRow): UserPreview {
	return {
		id: r.id,
		username: r.username,
		displayName: r.displayName,
		avatarUrl: buildAvatarUrl(r.id, r.avatarFileId, r.avatarContentType)
	};
}

/**
 * Batched by-id lookup of user previews (dedupes, drops sentinel ids, caps the
 * IN-list). For JOIN sites, spread `userPreviewColumns` into the query instead
 * so the user columns come back in the same round-trip.
 */
export async function getUserPreviewsById(db: D1Db, userIds: number[]): Promise<UserPreview[]> {
	const unique = Array.from(new Set(userIds)).filter((id) => isRealUserId(id));
	if (unique.length === 0) return [];
	const capped = unique.slice(0, MAX_USER_BATCH);
	const rows: UserPreviewRow[] = await db
		.select(userPreviewColumns)
		.from(users)
		.where(inArray(users.id, capped));
	return rows.map(toUserPreview);
}

/** Single by-id user preview lookup (null for sentinel/missing ids). */
export async function getUserPreview(db: D1Db, id: number): Promise<UserPreview | null> {
	if (!isRealUserId(id)) return null;
	const rows: UserPreviewRow[] = await db
		.select(userPreviewColumns)
		.from(users)
		.where(eq(users.id, id))
		.limit(1);
	return rows[0] ? toUserPreview(rows[0]) : null;
}
