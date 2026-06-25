import type { AuthorPreviewFields } from '$lib/types/api';

// Shared row-shape types for the discussion list row (`DiscussionRow`). Kept in
// a dedicated module (not inside the component) so both the online listing
// (DiscussionListPage) and the offline reader (`/offline`) can construct rows of
// the exact same shape without re-declaring the interface (similarity-ts
// forbids duplicate type shapes).

/**
 * Minimal projection of a discussion that DiscussionRow renders. `viewCount` is
 * optional: the offline cache does not store view counts, so the views label is
 * hidden when it is absent.
 */
export interface DiscussionRowItem extends AuthorPreviewFields {
	id: number;
	title: string;
	slug: string;
	authorId: number;
	viewCount?: number;
	commentCount: number;
	isPinned: boolean;
	lastReplyAt: Date | string | number;
}

/** Reading-progress state used to deep-link a row to the last-read reply. */
export interface DiscussionReadHistory {
	lastReadAt: Date | string | number | null;
	lastReadPage: number;
	lastReadReplyId: number | null;
}
