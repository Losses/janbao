import type {
	CachedAuthorProjection,
	CachedDiscussion,
	CachedReply,
	OfflineAuthorInfo,
	OfflineDiscussionView,
	OfflineReplyView
} from './types';

// Sentinel for a missing user. The reader falls back to a letter avatar +
// "Unknown user" label via the null fields (see queries.ts / +page.svelte).
const NULL_AUTHOR: Readonly<OfflineAuthorInfo> = Object.freeze({
	displayName: null,
	username: null,
	avatarUrl: null
});

// Look up an author's display info in a cached-users map. Returns nulls when
// the user isn't cached so the reader can fall back to a placeholder rather
// than crash. Passes through the server-built `avatarUrl` unchanged.
export function lookupAuthor(
	usersById: Map<number, CachedAuthorProjection>,
	authorId: number | null | undefined
): OfflineAuthorInfo {
	if (authorId == null) return NULL_AUTHOR;
	const u = usersById.get(authorId);
	if (!u) return NULL_AUTHOR;
	return {
		displayName: u.displayName,
		username: u.username,
		avatarUrl: u.avatarUrl
	};
}

export function joinReplies(
	replies: CachedReply[],
	usersById: Map<number, CachedAuthorProjection>
): OfflineReplyView[] {
	return replies.map((r) => ({ ...r, author: lookupAuthor(usersById, r.authorId) }));
}

export function joinDiscussions(
	discussions: CachedDiscussion[],
	usersById: Map<number, CachedAuthorProjection>
): OfflineDiscussionView[] {
	return discussions.map((d) => ({ ...d, author: lookupAuthor(usersById, d.authorId) }));
}
