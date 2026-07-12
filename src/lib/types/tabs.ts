/**
 * Shapes for the eager-loaded mobile tab pager. The `(tabs)` layout load returns
 * `TabsLayoutData` (all three tabs at page 1) so the pager can mount every panel
 * up front; the active tab's `?page` pagination is still served by the per-route
 * page loads. Shared with `NavPipelineTabHost` and the panel components so they
 * don't each redeclare the shapes.
 */
import type { DiscussionListItem } from '$lib/server/db/dao/discussions';
import type { ActivityPageResult } from '$lib/server/db/dao/activities';
import type { ConversationListItem } from '$lib/types/api';

export interface DiscussionsTabData {
	discussions: DiscussionListItem[];
	page: number;
	totalPages: number;
	totalCount: number;
}

export interface MessagesTabData {
	conversations: ConversationListItem[];
	page: number;
	totalPages: number;
	totalCount: number;
}

export interface TabsLayoutData {
	home: DiscussionsTabData;
	activity: ActivityPageResult;
	messages: MessagesTabData;
}

/** Builds the href for a given discussion-list page (1 -> "/", N -> "/discussions/pN"). */
export type PageUrlBuilder = (page: number) => string;
