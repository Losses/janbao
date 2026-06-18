import { getOfflineDB } from '$lib/offline/idb';
import { joinDiscussions } from '$lib/offline/join';
import type { CachedAuthorProjection } from '$lib/offline/types';
import type { PageLoad } from './$types';

// Client-only: the offline reading list reads straight from IndexedDB with no
// server round-trip, so it works with no network once the app shell is cached.
export const ssr = false;

export const load: PageLoad = async () => {
	const db = getOfflineDB();
	const discussions = await db.discussions.toArray();

	// Join author display info from the cached users store so DiscussionRow can
	// render avatars and names. Missing users degrade gracefully (placeholder).
	const authorIds = Array.from(new Set(discussions.map((d) => d.authorId)));
	const cachedUsers = await db.users.bulkGet(authorIds);
	const usersById = new Map<number, CachedAuthorProjection>();
	for (const u of cachedUsers) {
		if (u)
			usersById.set(u.id, {
				displayName: u.displayName,
				username: u.username,
				avatarFileId: u.avatarFileId
			});
	}

	const joined = joinDiscussions(discussions, usersById);
	// Mirror the live front-page order: pinned first, then lastReplyAt desc (NULL
	// last, matching the online home page which orders by bare lastReplyAt).
	joined.sort(
		(a, b) => Number(b.isPinned) - Number(a.isPinned) || (b.lastReplyAt ?? 0) - (a.lastReplyAt ?? 0)
	);
	return { discussions: joined };
};
