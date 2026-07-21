// DV07 C04 - read passthrough writer. Pure client-side IDB write of SSR data
// the page already received. Issues ZERO server requests (INV-4): every input
// arrives in the route's `data` prop. The only "fetcher" inside this module is
// `getOfflineDB()` (an IDB open). Guests cannot reach any authed route that
// feeds this writer (decision #5); the prefs gate is the sole gate.
//
// Two entry points consumed from `+page.svelte` `onMount` hooks:
//   - writeList(items)              for list pages (home, /discussions, category,
//                                   profile/discussions).
//   - writeThread({ discussion, opReply, replies, page, totalPages, pageSize })
//                                   for the thread page.
//
// Each call tags the touched rows with reason 'read' (UNION onto any existing
// reasons; never removes other reasons), sets readUpdatedAt to epoch SECONDS
// (Math.floor(Date.now()/1000)) - matching the cached-timestamp convention
// every other writer normalizes to via toEpochSeconds, and the unit
// isReadStale/expireReadReasons expect (RV07 C05 r2 audit A4: writing epoch
// ms here made nowSec - readUpdatedAt hugely negative, so 'read' never
// expired). cachedAt stays in ms (bookkeeping only, never TTL-math).
// For writeThread, also reconciles the replyCacheManifest from the live
// replies store so the manifest reflects what is ACTUALLY cached regardless
// of which writer put it there (sync depth-backfill OR passthrough).

import { getOfflineDB } from './idb';
import { recomputeManifestForDiscussion } from './manifest-recompute';
import { readOfflinePrefs } from './prefs';
import { REASON_ORDER } from './types';
import type { CachedDiscussion, CachedRange, CachedReply, CachedUser, Reason } from './types';
import type { SyncDiscussionDTO, SyncReplyDTO } from '$lib/types/api';
import { isRealUserId } from '$lib/utils/user';
import type { DiscussionListItem } from '$lib/server/db/dao/discussions';

// Pre-computed singleton so we never allocate a new array per row when the row
// already carries 'read'. The merge always returns a fresh array (so a missing
// prior array upgrades to a real one), but it picks this shared instance when
// no new reason would be added on top of an existing 'read'.
const READ_ONLY_REASONS: readonly Reason[] = ['read'];

// Time-ish value accepted from either SSR (Drizzle Date instances) or local
// DAOs (Date) - converted to epoch seconds inside the writer. Keeping it loose
// here lets the caller pass either shape without a manual conversion pass.
type Epochish = Date | number;

// Lean content shape we map discussion inputs into. Times arrive as either
// Date (Drizzle on the client) or epoch seconds (already-converted data); the
// writer normalizes to epoch seconds before persisting. The thread-page
// variant also carries viewCount (the list DAO doesn't).
interface LeanDiscussionFromList {
	id: number;
	title: string;
	slug: string;
	categorySlug: string;
	authorId: number;
	commentCount: number;
	isPinned: boolean;
	createdAt: Epochish;
	updatedAt: Epochish;
	lastReplyAt: Epochish | null;
}

interface LeanThreadDiscussion extends LeanDiscussionFromList {
	viewCount: number;
}

// Public input type for writeThread. Exported so callers (the thread route)
// can build the lean shape with proper typing rather than structural casts.
export interface ThreadPassthroughInput {
	discussion: LeanThreadDiscussion;
	opReply: ThreadReplyInput | null;
	replies: ThreadReplyInput[];
	page: number;
	totalPages: number;
	pageSize: number;
}

// Reply shape the thread +page.server.ts returns. Carries author display fields
// (richer than the sync DTO) plus optional editor display fields (joined from
// `editors` alias) so the writer can cache both the author and the editor as
// CachedUser rows.
interface ThreadReplyInput {
	id: number;
	contentJson: string;
	createdAt: Epochish;
	updatedAt: Epochish;
	editedAt: Epochish | null;
	editedBy: number | null;
	authorId: number;
	authorDisplayName: string;
	authorUsername: string;
	authorAvatarUrl: string | null;
	editedByDisplayName: string | null;
	editedByUsername: string | null;
}

interface AuthorInput {
	id: number;
	// Display fields are nullable so a writer that cannot resolve a display
	// value (e.g. a list page whose last-reply author has null display fields
	// in DiscussionListItem) stores `null` instead of baking in an English
	// fallback. CachedUser mirrors this nullability; the reader applies its
	// localized `unknownUser` fallback at render time.
	displayName: string | null;
	username: string | null;
	avatarUrl: string | null;
}

// Prefs gate (INV-4 stays intact by gating the entire entry point). Early-
// returns when disabled or passthrough off so the online path is byte-
// identical to before DV07.
function passthroughEnabled(): boolean {
	return readOfflinePrefs().enabled && readOfflinePrefs().passthrough;
}

// Minimal presence shape for the Decision #5 gate. We avoid importing the
// ambient global `UserData` (declared in src/app.d.ts, which is not in scope
// for this plain .ts module) and avoid coupling the offline layer to the full
// server-side user shape. Any non-null object with an `id` satisfies it; the
// layout's `data.user` (and the thread/profile routes' `data.user`) all conform.
interface AuthedUserRef {
	id: number;
}

// Decision #5 gate: guests must never populate a cache. Even on a PUBLIC route
// (`/`, `/discussions`, `/category/…`, profile-discussions, and the thread
// page) - where `data.user` is null for guests - a guest on an installed PWA
// (auto-enabled) would otherwise cache public list data via `writeList` /
// `writeThread`. This is the ONE place enforcing decision #5 on the
// passthrough path; every route's `runPassthrough` calls this with its `data.user`.
// Authed users browsing public routes still cache (correct).
export function passthroughEnabledFor(user: AuthedUserRef | null): boolean {
	return !!user && passthroughEnabled();
}

// Return the row's new reasons array after ensuring 'read' is present. Never
// drops other reasons. Deterministic ordering mirrors the orchestrator so a
// no-op write doesn't churn the array identity.
function withReadReason(existing: Reason[] | undefined): Reason[] {
	if (!existing || existing.length === 0) return [...READ_ONLY_REASONS];
	if (existing.includes('read')) {
		// Already present; preserve the existing array if it has exactly the
		// same members in canonical order, otherwise rebuild.
		const canonical = REASON_ORDER.filter((r) => existing.includes(r));
		if (canonical.length === existing.length && canonical.every((r, i) => r === existing[i])) {
			return existing;
		}
		return canonical;
	}
	return REASON_ORDER.filter((r) => existing.includes(r) || r === 'read');
}

// Convert Epochish (Date | number) to epoch seconds. Date → getTime()/1000;
// number is assumed to already be seconds (Drizzle timestamp mode stores
// seconds; the SyncDTO contract is seconds). A NaN/Infinity falls back to 0.
function toEpochSeconds(value: Epochish): number {
	if (value instanceof Date) {
		const ms = value.getTime();
		return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
	}
	if (typeof value === 'number' && Number.isFinite(value)) {
		// Heuristic: a value > 10^12 is in milliseconds, normalize to seconds.
		return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
	}
	return 0;
}

function mapListDiscussion(item: DiscussionListItem): LeanDiscussionFromList {
	const createdAt = toEpochSeconds(item.createdAt);
	const lastReplyAt =
		item.lastReplyAt instanceof Date || typeof item.lastReplyAt === 'number'
			? toEpochSeconds(item.lastReplyAt)
			: null;
	return {
		id: item.id,
		title: item.title,
		slug: item.slug,
		categorySlug: item.categorySlug,
		authorId: item.authorId,
		commentCount: item.commentCount,
		isPinned: item.isPinned,
		createdAt,
		updatedAt: lastReplyAt ?? createdAt,
		lastReplyAt
	};
}

// Map a thread-page author + reply to the cached user / reply row shapes. The
// thread page carries display fields directly on each reply (joined server-side
// for the live renderer), so we extract them here.
function replyAuthorFromThread(r: ThreadReplyInput): AuthorInput {
	return {
		id: r.authorId,
		displayName: r.authorDisplayName,
		username: r.authorUsername,
		avatarUrl: r.authorAvatarUrl
	};
}

// Editor projection: returns null when the reply has no editor id or no
// display info (a deleted editor account yields null display fields). The
// offline reader degrades gracefully for a missing CachedUser; we only cache
// what we can resolve from the join. The thread page has no editor avatar URL,
// so editor rows cache `avatarUrl: null` (letter-avatar fallback). The guard
// below ensures at least one source field is non-empty in the surviving
// branch; the symmetric `??` chains then guarantee BOTH locals hold that
// value, so no synthetic English fallback is needed.
function editorFromThread(r: ThreadReplyInput): AuthorInput | null {
	if (!isRealUserId(r.editedBy)) return null;
	const displayName = r.editedByDisplayName ?? r.editedByUsername;
	const username = r.editedByUsername ?? r.editedByDisplayName;
	if (!displayName && !username) return null;
	return {
		id: r.editedBy,
		displayName,
		username,
		avatarUrl: null
	};
}

function mapThreadReply(discussionId: number, r: ThreadReplyInput, now: number): CachedReply {
	return {
		id: r.id,
		discussionId,
		authorId: r.authorId,
		contentJson: r.contentJson,
		createdAt: toEpochSeconds(r.createdAt),
		updatedAt: toEpochSeconds(r.updatedAt),
		editedAt: r.editedAt != null ? toEpochSeconds(r.editedAt) : null,
		editedBy: r.editedBy ?? null,
		cachedAt: now
	};
}

function mapCachedUser(author: AuthorInput, now: number): CachedUser {
	return {
		id: author.id,
		displayName: author.displayName,
		username: author.username,
		avatarUrl: author.avatarUrl,
		cachedAt: now
	};
}

// Atomic discussion upsert: read the existing row (so we can carry forward
// non-read reasons + cachedAt), then merge the lean content + read reason +
// readUpdatedAt, and put. Normalizes Epochish times to epoch seconds so the
// stored row matches the SyncDTO contract (numbers).
function toStoredDiscussion(discussion: LeanDiscussionFromList): SyncDiscussionDTO {
	return {
		id: discussion.id,
		title: discussion.title,
		slug: discussion.slug,
		categorySlug: discussion.categorySlug,
		authorId: discussion.authorId,
		commentCount: discussion.commentCount,
		isPinned: discussion.isPinned,
		createdAt: toEpochSeconds(discussion.createdAt),
		updatedAt: toEpochSeconds(discussion.updatedAt),
		lastReplyAt:
			discussion.lastReplyAt instanceof Date || typeof discussion.lastReplyAt === 'number'
				? toEpochSeconds(discussion.lastReplyAt)
				: null
	};
}

async function upsertDiscussionWithRead(
	discussion: LeanDiscussionFromList,
	now: number
): Promise<void> {
	const db = getOfflineDB();
	const existing = await db.discussions.get(discussion.id);
	const merged: CachedDiscussion = {
		...toStoredDiscussion(discussion),
		cachedAt: existing?.cachedAt ?? now,
		reasons: withReadReason(existing?.reasons),
		readUpdatedAt: Math.floor(now / 1000)
	};
	await db.discussions.put(merged);
}

async function upsertUsers(authors: AuthorInput[], now: number): Promise<void> {
	if (authors.length === 0) return;
	const db = getOfflineDB();
	const seen = new Set<number>();
	const rows: CachedUser[] = [];
	for (const a of authors) {
		if (!isRealUserId(a.id)) continue;
		if (seen.has(a.id)) continue;
		seen.add(a.id);
		rows.push(mapCachedUser(a, now));
	}
	if (rows.length) await db.users.bulkPut(rows);
}

/**
 * List-page passthrough. Maps each list item to a lean CachedDiscussion,
 * upserts the discussion (reason 'read' union + readUpdatedAt), and writes
 * CachedUser rows for every distinct author seen (the list-page author +
 * lastReplyAuthor, when present). Issues no server request.
 */
export async function writeList(items: DiscussionListItem[]): Promise<void> {
	if (!passthroughEnabled()) return;
	if (items.length === 0) return;
	const now = Date.now();
	const db = getOfflineDB();

	const authors: AuthorInput[] = [];
	for (const item of items) {
		authors.push({
			id: item.authorId,
			displayName: item.authorDisplayName,
			username: item.authorUsername,
			avatarUrl: item.authorAvatarUrl
		});
		if (isRealUserId(item.lastReplyAuthorId)) {
			authors.push({
				id: item.lastReplyAuthorId,
				displayName: item.lastReplyAuthorDisplayName ?? item.lastReplyAuthorUsername ?? null,
				username: item.lastReplyAuthorUsername ?? null,
				// DiscussionListItem does not ship lastReplyAuthorAvatarUrl; the
				// cached row degrades to letter-avatar until the sync stream fills
				// it in.
				avatarUrl: null
			});
		}
	}

	// Read prior rows once (outside the txn) so we can carry forward their
	// cachedAt + non-read reasons across the upsert. Dexie transactions don't
	// forbid same-key reads + writes, but reading first keeps the merge logic
	// straightforward and avoids re-allocating the bulkGet inside the txn.
	const ids = items.map((i) => i.id);
	const existingRows = await db.discussions.bulkGet(ids);
	const priorById = new Map<number, CachedDiscussion>();
	for (const row of existingRows) {
		if (row) priorById.set(row.id, row);
	}

	const mergedDiscussions: CachedDiscussion[] = items.map((item) => {
		const stored = toStoredDiscussion(mapListDiscussion(item));
		const existing = priorById.get(stored.id);
		return {
			...stored,
			cachedAt: existing?.cachedAt ?? now,
			reasons: withReadReason(existing?.reasons),
			readUpdatedAt: Math.floor(now / 1000)
		};
	});

	await db.transaction('rw', db.discussions, db.users, async () => {
		await db.discussions.bulkPut(mergedDiscussions);
		await upsertUsers(authors, now);
	});
}

/**
 * Thread-page passthrough. Upserts the CachedDiscussion (lean shape + read
 * reason + readUpdatedAt), upserts opReply + replies as CachedReply rows,
 * upserts every distinct author (reply authors + OP author + editor), then
 * recomputes the replyCacheManifest from the live replies store so the
 * manifest reflects what is ACTUALLY on disk regardless of writer.
 */
export async function writeThread(input: ThreadPassthroughInput): Promise<void> {
	if (!passthroughEnabled()) return;
	const { discussion, opReply, replies, pageSize } = input;
	const now = Date.now();
	const db = getOfflineDB();

	// Gather authors: discussion's own author is implied by opReply, but include
	// it explicitly in case opReply is missing (a thread with no OP yet). Also
	// include each reply's editor when editedBy + at least one editor display
	// field is present (the editor's CachedUser row is needed by the offline
	// reader to render "edited by …" attribution without a server round-trip).
	const authors: AuthorInput[] = [];
	if (opReply) {
		authors.push(replyAuthorFromThread(opReply));
		const editor = editorFromThread(opReply);
		if (editor) authors.push(editor);
	}
	for (const r of replies) {
		authors.push(replyAuthorFromThread(r));
		const editor = editorFromThread(r);
		if (editor) authors.push(editor);
	}

	// Reply rows: dedupe by id (a thread could in theory have an empty replies
	// list but a present opReply, or the renderer could re-supply the OP under
	// some clients; treat opReply + replies as a union).
	const replyRows: CachedReply[] = [];
	const seenReplyIds = new Set<number>();
	if (opReply) {
		if (!seenReplyIds.has(opReply.id)) {
			seenReplyIds.add(opReply.id);
			replyRows.push(mapThreadReply(discussion.id, opReply, now));
		}
	}
	for (const r of replies) {
		if (seenReplyIds.has(r.id)) continue;
		seenReplyIds.add(r.id);
		replyRows.push(mapThreadReply(discussion.id, r, now));
	}

	await db.transaction('rw', db.discussions, db.replies, db.users, async () => {
		await upsertDiscussionWithRead(discussion, now);
		if (replyRows.length) await db.replies.bulkPut(replyRows);
		await upsertUsers(authors, now);
	});

	// Reconcile the manifest AFTER the txn commits. We claim ONLY the page the
	// user actually visited (input.page) - the cached OP does NOT, by itself,
	// claim any page (RV07 C04 r2 audit A4-1). The OP renders as a special
	// top-of-thread block and is not part of the paginated reply stream, so
	// caching it while visiting page 5 caches only [5,5], not [1,1]. When the
	// visited page IS page 1, the full paginated page-1 reply set is present,
	// so the claim [1,1] is correct (and is just the visited range).
	//
	// The helper reads prior ranges from IDB and unions them, so there are no
	// lost updates vs a concurrent sync write.
	if (pageSize > 0 && input.page >= 1) {
		const visitedRange: CachedRange = {
			start: input.page,
			end: Math.min(input.page, Math.max(1, input.totalPages))
		};
		await recomputeManifestForDiscussion(
			db,
			discussion.id,
			discussion.commentCount,
			pageSize,
			visitedRange
		);
	}
}

// Re-exported for type-checking ergonomics: the sync orchestrator imports the
// same DTOs to keep mapping round-trips consistent.
export type { SyncDiscussionDTO, SyncReplyDTO };
