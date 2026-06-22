import type {
	SyncActivityDTO,
	SyncCursors,
	SyncDiscussionDTO,
	SyncReplyDTO,
	SyncUserDTO
} from '$lib/types/api';

// DV07 reason enum (Plan decision #4): every cached discussion carries the
// union of reasons it is currently cached under. A row is deleted only when
// this set is fully empty (reason-set eviction). 'read' is owned by the
// passthrough layer (C04); the orchestrator never adds/removes it.
//   'latest' | 'mostViewed' | 'mostReplied' - curated category membership.
//   'read'                                   - user browsed the thread online.
//   'front'                                  - on the cached front-page snapshot.
//   'bookmark'                               - in the cached bookmark snapshot.
export type Reason = 'latest' | 'mostViewed' | 'mostReplied' | 'read' | 'front' | 'bookmark';

// Deterministic reason ordering shared by every layer that builds or filters a
// reasons array (passthrough writer, sync orchestrator's recompute, evict's
// withoutRead). Hoisted here so the 6-entry order lives in exactly one place
// (RV07 C05 r2 audit A5: previously duplicated as REASON_ORDER in evict.ts +
// passthrough.ts and ORDER in sync-orchestrator.ts). The order is load-bearing:
// passthrough's withReadReason filters existing arrays against this and must
// match the orchestrator's recompute output, or every passthrough write would
// churn the array identity of an already-cached row (spurious diff noise).
export const REASON_ORDER: readonly Reason[] = [
	'latest',
	'mostViewed',
	'mostReplied',
	'read',
	'front',
	'bookmark'
];

// IndexedDB row shapes. The content rows mirror the server DTOs plus a cachedAt
// bookkeeping timestamp (ms) used only for diagnostics.
export interface CachedDiscussion extends SyncDiscussionDTO {
	cachedAt: number;
	// DV07: reasons this row is kept in the cache (eviction source of truth) +
	// the timestamp of its last 'read' passthrough write (TTL target for C05).
	// Optional so a v3 row upgrades in place without a migration (the next sync
	// backfills them); newly written rows always carry both fields.
	reasons?: Reason[];
	readUpdatedAt?: number;
}

export interface CachedReply extends SyncReplyDTO {
	cachedAt: number;
}

// Author display info cached so the offline reader can render avatars and
// names without a server round-trip. Mirrors SyncUserDTO plus cachedAt.
export interface CachedUser extends SyncUserDTO {
	cachedAt: number;
}

// First-page activity feed row cached for /offline/activity. Mirrors
// SyncActivityDTO plus a cachedAt bookkeeping timestamp.
export interface CachedActivity extends SyncActivityDTO {
	cachedAt: number;
}

// Shared by the read-state outbox (readStatePending, keyed by discussionId +
// lastReadAt) and the merged display state (readStateMerged, keyed by
// discussionId). Same shape, two stores.
export interface OfflineReadState {
	discussionId: number;
	lastReadReplyId: number | null;
	lastReadPage: number;
	lastReadAt: number;
}

// Compound primary key of the readStatePending store: [discussionId, lastReadAt].
export type ReadStateKey = [number, number];

// syncMeta is a grab-bag keyed store; value is one of these shapes. Includes
// the DV07 curated-mirror records (per-category { ids, fetchedAt }) used by
// the refresh-diff in C05 - they are objects, so SyncMetaValue accepts them
// via the CuratedSyncMetaRecord union.
export type SyncMetaValue =
	| number
	| string
	| number[]
	| SyncCursors
	| CuratedSyncMetaRecord
	| CuratedSyncMetaMap
	| null;

export interface SyncMetaRow {
	key: string;
	value: SyncMetaValue;
}

export interface SyncResult {
	discussions: number;
	replies: number;
	tombstones: number;
}

// Author display info joined onto a cached reply/discussion for the offline
// reader UI. All fields optional because the user may not yet be cached (e.g.
// an author whose content was synced before the users stream shipped, or an
// editedBy referencing a deleted account). The reader degrades gracefully:
// avatar falls back to a letter, name to "Unknown user".
export interface OfflineAuthorInfo {
	displayName: string | null;
	username: string | null;
	avatarFileId: string | null;
}

// Minimal projection of a CachedUser used as the join map's value type. Kept
// separate from OfflineAuthorInfo so the load functions can build a Map keyed
// by user id without resorting to inline object-type literals.
export interface CachedAuthorProjection {
	displayName: string;
	username: string;
	avatarFileId: string | null;
}

// A cached reply joined with its author display info, ready for the reader UI.
export interface OfflineReplyView {
	id: number;
	discussionId: number;
	authorId: number;
	contentJson: string;
	createdAt: number;
	updatedAt: number;
	editedAt: number | null;
	editedBy: number | null;
	author: OfflineAuthorInfo;
}

// A cached discussion joined with its author display info, ready for the list
// UI. Matches the shape DiscussionRow expects via OfflineDiscussionRowItem.
export interface OfflineDiscussionView {
	id: number;
	title: string;
	slug: string;
	categorySlug: string;
	authorId: number;
	commentCount: number;
	isPinned: boolean;
	createdAt: number;
	updatedAt: number;
	lastReplyAt: number | null;
	author: OfflineAuthorInfo;
}

// Reduced projection of a cached discussion for the offline bookmarks list.
// categoryTitle / bookmarkedAt are not synced, so the bookmark view shows the
// category as its slug and no bookmark-date column.
export interface OfflineBookmarkView {
	discussionId: number;
	title: string;
	slug: string;
	categorySlug: string;
	authorId: number;
	authorDisplayName: string;
	authorUsername: string;
}

// DV07 replyCacheManifest store row. One per cached discussion that received
// depth-aware reply backfill. cachedRanges is a list of inclusive [start,end]
// page-number intervals the cache holds for this discussion; `complete` is
// true iff every page [1,totalPages] is cached (so the gap-renderer can skip
// the divider entirely).
export interface CachedRange {
	start: number;
	end: number;
}

export interface ReplyCacheManifestRow {
	discussionId: number;
	totalPages: number;
	pageSize: number;
	cachedRanges: CachedRange[];
	complete: boolean;
}

// DV07 curated-mirror record persisted in syncMeta so C05 can diff the prior
// sync's curated id set against the current one (drop reasons for ids no
// longer in a category, append reasons for new entrants). One record per
// category; bundled under syncMeta key 'curated' as a CuratedSyncMetaMap.
export interface CuratedSyncMetaRecord {
	ids: number[];
	fetchedAt: number;
}

export interface CuratedSyncMetaMap {
	latest?: CuratedSyncMetaRecord;
	mostViewed?: CuratedSyncMetaRecord;
	mostReplied?: CuratedSyncMetaRecord;
}
