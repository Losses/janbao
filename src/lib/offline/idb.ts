import Dexie, { type Table } from 'dexie';
import type {
	CachedDiscussion,
	CachedReply,
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
	}
}

let dbInstance: ForumOfflineDB | null = null;

export function getOfflineDB(): ForumOfflineDB {
	if (!dbInstance) dbInstance = new ForumOfflineDB();
	return dbInstance;
}
