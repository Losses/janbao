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
	if (!dbInstance) {
		const instance = new ForumOfflineDB();
		// Schema upgrades (e.g. the v1 -> v2 bump that added `users`) only run
		// once no other connection holds the database open. If a stale
		// connection blocks the upgrade, Dexie's open() promise waits for it
		// indefinitely — and since the `/offline` routes call getOfflineDB() as
		// the first line of their load(), that hang surfaces as the page's
		// loading spinner never resolving. Two hygiene measures prevent that:
		//
		// 1. versionchange: when another connection wants to change the DB
		//    version (a new tab, or a just-deployed schema bump), close ours
		//    promptly so the upgrade can proceed. This is Dexie's recommended
		//    pattern; once every live connection follows it, a version bump
		//    never deadlocks.
		// 2. blocked: if our own open is blocked by a connection that does not
		//    step aside, surface it loudly instead of hanging in silence.
		instance.on('versionchange', () => {
			instance.close();
		});
		instance.on('blocked', () => {
			console.warn(
				'[offline] IndexedDB upgrade is blocked by another open connection. ' +
					'Close other tabs / dev servers targeting this site, or clear the "forum-offline" database in DevTools.'
			);
		});
		dbInstance = instance;
	}
	return dbInstance;
}

// Vite HMR can re-import this module during dev, replacing the singleton while
// the previous Dexie connection stays open. That orphaned connection then
// blocks the next schema upgrade. Dispose closes it on hot-reload so dev
// iterations never leak blocking connections. (import.meta.hot is undefined in
// the production build and in non-Vite runtimes, so the guard is a no-op there.)
if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		dbInstance?.close();
		dbInstance = null;
	});
}
