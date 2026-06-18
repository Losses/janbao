import type { SyncCursors, SyncDiscussionDTO, SyncReplyDTO, SyncUserDTO } from '$lib/types/api';

// IndexedDB row shapes. The content rows mirror the server DTOs plus a cachedAt
// bookkeeping timestamp (ms) used only for diagnostics.
export interface CachedDiscussion extends SyncDiscussionDTO {
	cachedAt: number;
}

export interface CachedReply extends SyncReplyDTO {
	cachedAt: number;
}

// Author display info cached so the offline reader can render avatars and
// names without a server round-trip. Mirrors SyncUserDTO plus cachedAt.
export interface CachedUser extends SyncUserDTO {
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

// syncMeta is a grab-bag keyed store; value is one of these shapes.
export type SyncMetaValue = number | string | number[] | SyncCursors | null;

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
