import { getOfflineDB } from '$lib/offline/idb';
import { joinReplies } from '$lib/offline/join';
import { computeReplyGaps, type ReplyGapSummary } from '$lib/offline/manifest';
import type { CachedAuthorProjection } from '$lib/offline/types';
import type { PageLoad } from './$types';

// Sentinel returned when there is no manifest yet (e.g. an old DV06 row that
// predates the v4 schema, or a freshly-evicted discussion). The renderer
// treats this as "no gaps to draw".
const EMPTY_GAPS: ReplyGapSummary = {
	gaps: [],
	totalMissingPages: 0,
	totalMissingReplies: 0,
	pageSize: 0,
	totalPages: 0,
	cachedRanges: []
};

// Client-only: reads the cached discussion + its replies from IndexedDB. Has no
// +page.server.ts by design (INV-4) - it cannot trigger the online read mechanism.
//
// Unlike the offline LIST pages (/, bookmarks, activity), the reader stays
// `ssr = false`: its entire body is client-only IDB content, so server-rendering
// it would emit an empty shell anyway. The reader's logged-in state (the
// sidebar's user/t, provided by the root layout load) is preserved by the
// service worker treating __data.json as network-first (service-worker.ts), so
// a stale logged-out data response is never replayed. The list pages are SSR'd
// because their login state is worth embedding; the reader is not, by design.
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
				avatarUrl: u.avatarUrl ?? null
			});
	}

	const joinedReplies = joinReplies(replies, usersById);

	// Bookmark state comes from the bookmarks snapshot cached while online. The
	// star is read-only in the offline reader (no server mutation while offline).
	const bookmarksRow = await db.syncMeta.get('bookmarksSnapshot');
	const snapshot = bookmarksRow?.value;
	const isBookmarked = Array.isArray(snapshot) && snapshot.some((v) => v === discussionId);

	// DV07 multi-range gap view: the manifest is now AUTHORITATIVELY derived
	// from the live replies store (manifest-recompute.ts) by whichever writer
	// (sync depth-backfill OR passthrough page-visit) most recently touched it,
	// so this gap view is always accurate. Falls back to EMPTY_GAPS when no
	// manifest row exists yet (e.g. a fresh DV06 row before any passthrough
	// write) so the renderer renders no dividers.
	const manifestRow = await db.replyCacheManifest.get(discussionId);
	const replyGaps = discussion
		? computeReplyGaps(manifestRow, discussion.commentCount)
		: EMPTY_GAPS;

	// Honest list-only empty state (C06 r2 A1): when a discussion row exists in
	// IDB but has NO manifest AND NO cached replies, the only writer that
	// touched it was `writeList` (list-page passthrough). The row's metadata
	// was downloaded - so listing it on /offline is correct - but its thread
	// content is not. Surface this so the reader can render a distinct "listing
	// only" message instead of the generic "not cached" one. The `manifestRow`
	// null check excludes partially-evicted rows that still carry a manifest.
	const listingOnly = !!discussion && replies.length === 0 && manifestRow == null;

	return { discussion, replies: joinedReplies, discussionId, isBookmarked, replyGaps, listingOnly };
};
