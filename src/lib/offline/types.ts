import type { SyncCursors, SyncDiscussionDTO, SyncReplyDTO } from '$lib/types/api';

// IndexedDB row shapes. The content rows mirror the server DTOs plus a cachedAt
// bookkeeping timestamp (ms) used only for diagnostics.
export interface CachedDiscussion extends SyncDiscussionDTO {
	cachedAt: number;
}

export interface CachedReply extends SyncReplyDTO {
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
