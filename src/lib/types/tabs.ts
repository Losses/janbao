/**
 * Shapes for the eager-loaded mobile tab pager. The `(tabs)` layout load returns
 * `TabsLayoutData` (all three tabs at page 1) so the pager can mount every panel
 * up front; the active tab's `?page` pagination is still served by the per-route
 * page loads. Shared with `MobileTabPager` and the panel components so they
 * don't each redeclare the shapes.
 */
import type { DiscussionListItem } from '$lib/server/db/dao/discussions';
import type { ActivityPageResult } from '$lib/server/db/dao/activities';
import type { ConversationListItem, UserInfoSummary } from '$lib/types/api';
import type { TranslationDict } from '$lib/types/translation';
import type { ListCacheStore } from '$lib/stores/list-cache.svelte';

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

/** Unified props for the tab list-panel wrappers (TabDiscussionsPanel etc.) so
 * MOBILE_TABS can hold a single concrete `Component<TabPanelWrapperProps>`
 * rather than a union of the heterogeneous underlying Panels. Each wrapper owns
 * the cache -> Panel wiring (items, currentPage, totalPages, special props). */
export interface TabPanelWrapperProps {
	cache: ListCacheStore;
	t: TranslationDict;
	user: UserInfoSummary | null;
}
