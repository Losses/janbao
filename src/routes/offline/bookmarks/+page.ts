import { getOfflineDB } from '$lib/offline/idb';
import { lookupAuthor } from '$lib/offline/join';
import type { CachedAuthorProjection } from '$lib/offline/types';
import type { PageLoad } from './$types';

// Client-only: reads the cached bookmarks snapshot + the backfilled discussion
// details from IndexedDB. categoryTitle / bookmarkedAt aren't synced, so this
// is a reduced view (category shown as its slug, no bookmark-date column).
export const ssr = false;

interface OfflineBookmarkView {
	discussionId: number;
	title: string;
	slug: string;
	categorySlug: string;
	authorId: number;
	authorDisplayName: string;
	authorUsername: string;
}

export const load: PageLoad = async () => {
	const db = getOfflineDB();
	const row = await db.syncMeta.get('bookmarksSnapshot');
	const ids = Array.isArray(row?.value)
		? (row.value.filter((v) => typeof v === 'number') as number[])
		: [];
	if (ids.length === 0) return { bookmarks: [] as OfflineBookmarkView[] };

	const discussions = (await db.discussions.bulkGet(ids)).filter(
		(d): d is NonNullable<typeof d> => d != null
	);
	// Most-recently-active first (the snapshot carries no bookmark timestamp).
	discussions.sort((a, b) => {
		const ta = a.lastReplyAt ?? a.createdAt;
		const tb = b.lastReplyAt ?? b.createdAt;
		return tb - ta;
	});

	const userIds = new Set<number>();
	discussions.forEach((d) => userIds.add(d.authorId));
	const users = await db.users.bulkGet(Array.from(userIds));
	const usersById = new Map<number, CachedAuthorProjection>();
	for (const u of users) {
		if (u)
			usersById.set(u.id, {
				displayName: u.displayName,
				username: u.username,
				avatarFileId: u.avatarFileId
			});
	}

	const bookmarks: OfflineBookmarkView[] = discussions.map((d) => {
		const author = lookupAuthor(usersById, d.authorId);
		return {
			discussionId: d.id,
			title: d.title,
			slug: d.slug,
			categorySlug: d.categorySlug,
			authorId: d.authorId,
			authorDisplayName: author.displayName ?? '',
			authorUsername: author.username ?? ''
		};
	});

	return { bookmarks };
};
