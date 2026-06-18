import type {
	CachedAuthorProjection,
	CachedDiscussion,
	CachedReply,
	OfflineAuthorInfo,
	OfflineDiscussionView,
	OfflineReplyView
} from './types';

// Look up an author's display info in a cached-users map. Returns nulls when
// the user isn't cached so the reader can fall back to a placeholder rather
// than crash.
export function lookupAuthor(
	usersById: Map<number, CachedAuthorProjection>,
	authorId: number | null | undefined
): OfflineAuthorInfo {
	if (authorId == null) return { displayName: null, username: null, avatarFileId: null };
	const u = usersById.get(authorId);
	if (!u) return { displayName: null, username: null, avatarFileId: null };
	return { displayName: u.displayName, username: u.username, avatarFileId: u.avatarFileId };
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
