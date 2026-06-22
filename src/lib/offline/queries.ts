import { getOfflineDB } from '$lib/offline/idb';
import { joinDiscussions, lookupAuthor } from '$lib/offline/join';
import type { ActivityListItem } from '$lib/types/api';
import type { DiscussionRowItem } from '$lib/types/discussion-row';
import type {
	CachedAuthorProjection,
	OfflineBookmarkView,
	OfflineDiscussionView
} from '$lib/offline/types';

/**
 * Project a cached discussion into the shape `DiscussionRow` renders, shared by
 * the `/offline` route and the DiscussionsPanel's offline mode. viewCount is
 * omitted (not cached) so the views label is hidden; lastReplyAt falls back to
 * createdAt (the online DAO coalesces the same way) so reply-less threads still
 * show a timestamp instead of 1970. `unknownUser` substitutes for a missing
 * author display name. The avatar URL is the server-built value carried through
 * IDB (CachedUser.avatarUrl) - the client renders it as-is, never builds one.
 */
export function mapOfflineDiscussionRow(
	d: OfflineDiscussionView,
	unknownUser: string
): DiscussionRowItem {
	return {
		id: d.id,
		title: d.title,
		slug: d.slug,
		authorId: d.authorId,
		authorDisplayName: d.author.displayName ?? unknownUser,
		authorUsername: d.author.username ?? 'user',
		authorAvatarUrl: d.author.avatarUrl,
		commentCount: d.commentCount,
		isPinned: d.isPinned,
		lastReplyAt: (d.lastReplyAt ?? d.createdAt) * 1000
	};
}

/**
 * Client-only IDB read helpers for the offline list pages. Each route's page
 * component calls these from `onMount` (not a `load`) so the route stays
 * server-rendered: the layout's `user`/`t` are embedded in the SSR'd document
 * (login state survives offline / direct load), while the cached content reads
 * from IndexedDB after hydration. dexie therefore never runs on the server.
 */

// Build a user-id -> display-info projection from the cached users store,
// shared by every list loader so avatars/names render without a server hop.
// Carries the server-built avatarUrl straight through (no client URL building).
async function loadAuthorMap(authorIds: number[]): Promise<Map<number, CachedAuthorProjection>> {
	const db = getOfflineDB();
	const users = await db.users.bulkGet(Array.from(new Set(authorIds)));
	const map = new Map<number, CachedAuthorProjection>();
	for (const u of users) {
		if (u) {
			map.set(u.id, {
				displayName: u.displayName,
				username: u.username,
				avatarUrl: u.avatarUrl ?? null
			});
		}
	}
	return map;
}

// Cached discussions joined with author display info, ordered to mirror the
// live front page: pinned first, then lastReplyAt desc (NULL last, matching the
// online home which orders by bare lastReplyAt), then id desc as a stable
// tiebreaker against the server's desc(id) ordering.
export async function loadOfflineDiscussions(): Promise<OfflineDiscussionView[]> {
	const db = getOfflineDB();
	const discussions = await db.discussions.toArray();
	const usersById = await loadAuthorMap(discussions.map((d) => d.authorId));
	const joined = joinDiscussions(discussions, usersById);
	joined.sort(
		(a, b) =>
			Number(b.isPinned) - Number(a.isPinned) ||
			(b.lastReplyAt ?? 0) - (a.lastReplyAt ?? 0) ||
			b.id - a.id
	);
	return joined;
}

// Cached bookmark snapshot joined with author display info. categoryTitle /
// bookmarkedAt aren't synced, so this is a reduced view (category shown as its
// slug, no bookmark-date column). Most-recently-active first.
export async function loadOfflineBookmarks(): Promise<OfflineBookmarkView[]> {
	const db = getOfflineDB();
	const row = await db.syncMeta.get('bookmarksSnapshot');
	const ids = Array.isArray(row?.value)
		? (row.value.filter((v) => typeof v === 'number') as number[])
		: [];
	if (ids.length === 0) return [];

	const discussions = (await db.discussions.bulkGet(ids)).filter(
		(d): d is NonNullable<typeof d> => d != null
	);
	discussions.sort((a, b) => {
		const ta = a.lastReplyAt ?? a.createdAt;
		const tb = b.lastReplyAt ?? b.createdAt;
		return tb - ta;
	});

	const usersById = await loadAuthorMap(discussions.map((d) => d.authorId));
	return discussions.map((d) => {
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
}

// Cached first-page activity feed joined with author + recipient display info.
// Restores the server's feed ordering (COALESCE(updatedAt, createdAt) DESC,
// id DESC) since IDB only indexes createdAt. joinedMembers / @-mentions aren't
// synced, so isJoined rows degrade (empty roster) and chips render as text.
// Author avatar URLs come from the cached users store (server-built values).
export async function loadOfflineActivity(): Promise<ActivityListItem[]> {
	const db = getOfflineDB();
	const cached = await db.activities.toArray();
	cached.sort((a, b) => {
		const ta = a.updatedAt ?? a.createdAt;
		const tb = b.updatedAt ?? b.createdAt;
		if (ta !== tb) return tb - ta;
		return b.id - a.id;
	});

	const authorIds: number[] = [];
	cached.forEach((a) => {
		authorIds.push(a.authorId);
		if (a.recipientId != null) authorIds.push(a.recipientId);
	});
	const usersById = await loadAuthorMap(authorIds);

	return cached.map((a) => {
		const author = lookupAuthor(usersById, a.authorId);
		const recipient = a.recipientId != null ? lookupAuthor(usersById, a.recipientId) : null;
		return {
			id: a.id,
			authorId: a.authorId,
			authorDisplayName: author.displayName ?? '',
			authorUsername: author.username ?? '',
			authorAvatarUrl: author.avatarUrl,
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
}
