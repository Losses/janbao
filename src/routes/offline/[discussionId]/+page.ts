import { getOfflineDB } from '$lib/offline/idb';
import { joinReplies } from '$lib/offline/join';
import { computeReplyGaps, type ReplyGapSummary } from '$lib/offline/manifest';
import type { CachedAuthorProjection, CachedDiscussion } from '$lib/offline/types';
import type { PageLoad } from './$types';

// When a discussion was backfilled as first/last-page-only (front-page or
// bookmarked threads whose full reply history exceeds the cached endpoints),
// the reader shows how many replies/pages sit in the uncached middle, with a
// divider between the cached first page and last page.
//
// DV07 C02 also exposes `replyGaps` derived from the replyCacheManifest row,
// which is the generalized multi-range view. The current renderer still
// consumes `partialGap` (single-divider); C04 will switch it to render each
// gap in `replyGaps.gaps` and this legacy field will be removed.
interface PartialGapInfo {
	uncachedCount: number;
	uncachedPages: number;
	firstPageRestCount: number;
}

function computePartialGap(
	discussion: CachedDiscussion | null,
	cachedReplyCount: number,
	partialIds: number[],
	discussionId: number,
	pageSize: number
): PartialGapInfo | null {
	if (!discussion || pageSize <= 0 || !partialIds.includes(discussionId)) return null;
	const uncachedCount = Math.max(0, discussion.commentCount - cachedReplyCount);
	if (uncachedCount <= 0 || cachedReplyCount <= pageSize) return null;
	return {
		uncachedCount,
		uncachedPages: Math.ceil(uncachedCount / pageSize),
		// The OP occupies the first slot of the cached first page, so the rest-list
		// divider sits after (pageSize - 1) opening replies.
		firstPageRestCount: Math.max(0, pageSize - 1)
	};
}

// Sentinel returned when there is no manifest yet (e.g. an old DV06 row that
// predates the v4 schema). The renderer treats this as "no gaps to draw".
const EMPTY_GAPS: ReplyGapSummary = { gaps: [], totalMissingPages: 0, totalMissingReplies: 0 };

// Client-only: reads the cached discussion + its replies from IndexedDB. Has no
// +page.server.ts by design (INV-4) - it cannot trigger the online read mechanism.
export const ssr = false;

export const load: PageLoad = async ({ params }) => {
	const discussionId = Number(params.discussionId);
	const db = getOfflineDB();
	const discussion = (await db.discussions.get(discussionId)) ?? null;
	const replies = await db.replies.where('discussionId').equals(discussionId).sortBy('createdAt');

	// Join author display info from the cached users store so the reader can
	// render avatars and names. Missing users degrade gracefully (placeholder).
	const authorIds = new Set<number>();
	replies.forEach((r) => {
		authorIds.add(r.authorId);
		if (r.editedBy != null) authorIds.add(r.editedBy);
	});
	const cachedUsers = await db.users.bulkGet(Array.from(authorIds));
	const usersById = new Map<number, CachedAuthorProjection>();
	for (const u of cachedUsers) {
		if (u)
			usersById.set(u.id, {
				displayName: u.displayName,
				username: u.username,
				avatarFileId: u.avatarFileId
			});
	}

	const joinedReplies = joinReplies(replies, usersById);

	// Bookmark state comes from the bookmarks snapshot cached while online. The
	// star is read-only in the offline reader (no server mutation while offline).
	const bookmarksRow = await db.syncMeta.get('bookmarksSnapshot');
	const snapshot = bookmarksRow?.value;
	const isBookmarked = Array.isArray(snapshot) && snapshot.some((v) => v === discussionId);

	const partialRow = await db.syncMeta.get('partialReplyDiscussions');
	const partialIds = Array.isArray(partialRow?.value)
		? (partialRow.value.filter((v) => typeof v === 'number') as number[])
		: [];
	const pageSizeRow = await db.syncMeta.get('replyPageSize');
	const pageSize = typeof pageSizeRow?.value === 'number' ? pageSizeRow.value : 0;
	const partialGap = computePartialGap(
		discussion,
		replies.length,
		partialIds,
		discussionId,
		pageSize
	);

	// DV07 generalized gap view: derive the uncached page-ranges from the
	// manifest row (if present). Falls back to EMPTY_GAPS when the discussion
	// was cached by DV06 (no manifest yet) so the renderer still works. C04
	// will switch the renderer from `partialGap` to `replyGaps.gaps`.
	const manifestRow = await db.replyCacheManifest.get(discussionId);
	const replyGaps = discussion
		? computeReplyGaps(manifestRow, discussion.commentCount)
		: EMPTY_GAPS;

	return { discussion, replies: joinedReplies, discussionId, isBookmarked, partialGap, replyGaps };
};
