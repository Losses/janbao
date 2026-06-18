import { getOfflineDB } from '$lib/offline/idb';
import { lookupAuthor } from '$lib/offline/join';
import type { ActivityListItem } from '$lib/components/organisms/ActivityList.svelte';
import type { CachedAuthorProjection } from '$lib/offline/types';
import type { PageLoad } from './$types';

// Client-only: reads the cached first-page activity feed from IndexedDB. Has no
// +page.server.ts by design - the online /activity load is a pure SELECT (no
// viewCount / read-state / notification writes), so reading offline incurs no
// INV-4 "false read" risk; this route exists purely to avoid the offline
// server-load RPC failure and to keep all offline readers under /offline/*.
export const ssr = false;

export const load: PageLoad = async () => {
	const db = getOfflineDB();
	const cached = await db.activities.toArray();
	// Restore the server's feed ordering (COALESCE(updatedAt, createdAt) DESC,
	// id DESC) - IDB only indexes createdAt, so updatedAt-bumped rows would
	// otherwise drift out of place.
	cached.sort((a, b) => {
		const ta = a.updatedAt ?? a.createdAt;
		const tb = b.updatedAt ?? b.createdAt;
		if (ta !== tb) return tb - ta;
		return b.id - a.id;
	});

	const userIds = new Set<number>();
	cached.forEach((a) => {
		userIds.add(a.authorId);
		if (a.recipientId != null) userIds.add(a.recipientId);
	});
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

	// joinedMembers and @-mentions are not synced, so isJoined rows degrade
	// (empty roster) and chips render as plain text.
	const activities: ActivityListItem[] = cached.map((a) => {
		const author = lookupAuthor(usersById, a.authorId);
		const recipient = a.recipientId != null ? lookupAuthor(usersById, a.recipientId) : null;
		return {
			id: a.id,
			authorId: a.authorId,
			authorDisplayName: author.displayName ?? '',
			authorUsername: author.username ?? '',
			authorAvatarFileId: author.avatarFileId,
			recipientId: a.recipientId,
			recipientDisplayName: recipient?.displayName ?? null,
			recipientUsername: recipient?.username ?? null,
			contentJson: a.contentJson,
			createdAt: new Date(a.createdAt * 1000),
			commentCount: a.commentCount,
			isJoined: a.isJoined,
			joinedMembers: []
		};
	});

	return { activities };
};
