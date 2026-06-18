import Dexie, { type Table } from 'dexie';
import type {
	CachedDiscussion,
	CachedReply,
	CachedUser,
	OfflineReadState,
	ReadStateKey,
	SyncMetaRow
} from './types';

/**
 * IndexedDB store for the offline reader. Opened lazily (client-only); these
 * modules are imported solely from client-only contexts (the `/offline` routes
 * with `ssr = false`, and `+layout.svelte`'s onMount), so dexie never runs on the
 * server.
 */
export class ForumOfflineDB extends Dexie {
	discussions!: Table<CachedDiscussion, number>;
	replies!: Table<CachedReply, number>;
	users!: Table<CachedUser, number>;
	readStatePending!: Table<OfflineReadState, ReadStateKey>;
	readStateMerged!: Table<OfflineReadState, number>;
	syncMeta!: Table<SyncMetaRow, string>;

	constructor() {
		super('forum-offline');
		this.version(1).stores({
			discussions: 'id, updatedAt, categorySlug, lastReplyAt',
			replies: 'id, discussionId, [discussionId+createdAt], updatedAt',
			readStatePending: '[discussionId+lastReadAt], discussionId',
			readStateMerged: 'discussionId',
			syncMeta: 'key'
		});
		// v2 adds the `users` store: per-author display info (displayName,
		// username, avatar) cached so the offline reader can render avatars and
		// names without a server round-trip. keyPath is the user id; the
		// pre-existing stores are unchanged so a v1 client upgrades in place.
		this.version(2).stores({
			discussions: 'id, updatedAt, categorySlug, lastReplyAt',
			replies: 'id, discussionId, [discussionId+createdAt], updatedAt',
			users: 'id',
			readStatePending: '[discussionId+lastReadAt], discussionId',
			readStateMerged: 'discussionId',
			syncMeta: 'key'
		});
	}
}

let dbInstance: ForumOfflineDB | null = null;

export function getOfflineDB(): ForumOfflineDB {
	if (!dbInstance) dbInstance = new ForumOfflineDB();
	return dbInstance;
}
