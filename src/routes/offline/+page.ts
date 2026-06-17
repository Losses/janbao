import { getOfflineDB } from '$lib/offline/idb';
import type { PageLoad } from './$types';

// Client-only: the offline reading list reads straight from IndexedDB with no
// server round-trip, so it works with no network once the app shell is cached.
export const ssr = false;

export const load: PageLoad = async () => {
	const db = getOfflineDB();
	const discussions = await db.discussions.toArray();
	// Mirror the live front-page order: pinned first, then lastReplyAt desc (NULL
	// last, matching the online home page which orders by bare lastReplyAt).
	discussions.sort(
		(a, b) => Number(b.isPinned) - Number(a.isPinned) || (b.lastReplyAt ?? 0) - (a.lastReplyAt ?? 0)
	);
	return { discussions };
};
