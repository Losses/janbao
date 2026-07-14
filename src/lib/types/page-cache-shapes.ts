// src/lib/types/page-cache-shapes.ts
/**
 * Typed shapes for the entries the page cache holds. The cache itself
 * (`src/lib/stores/page-cache.svelte.ts`) is opaque: `data` is typed
 * `UnknownPageData`. Consumers narrow by importing the matching shape
 * here and casting.
 *
 * Shapes are organized by the route family that produces them:
 *
 *   - `DiscussionsListCacheData`  - the `/` tab list payload
 *   - `ActivityListCacheData`     - the `/activity` tab list payload
 *   - `MessagesListCacheData`     - the `/messages/inbox` tab list
 *   - `SearchScopeCacheData`      - one of the four `/search?scope=`
 *                                   result sets (carries its own
 *                                   `(q, sort)` for freshness checks)
 *
 * A consumer that reads `pageCache.get(pathname)` casts `entry.data`
 * to one of these. The route-keyed lookup guarantees the shape.
 */

import type { MentionedUsersMap } from '$lib/types/mentions';
import type { DiscussionListItem } from '$lib/server/db/dao/discussions';
import type { ActivityListItem, ConversationListItem } from '$lib/types/api';
import type {
	DiscussionSearchItem,
	ActivitySearchItem,
	MessageSearchItem,
	UserSearchItem
} from '$lib/server/db/dao/search';
import type { SearchSort } from '$lib/types/search';

/**
 * The discussion list payload cached under `/`. Mirrors the layout
 * server load's `home` field shape (without the wrapper).
 */
export interface DiscussionsListCacheData {
	discussions: DiscussionListItem[];
	page: number;
	totalPages: number;
	totalCount: number;
}

/**
 * The activity feed payload cached under `/activity`. Carries the
 * composer state (draft, mentioned users) alongside the items.
 */
export interface ActivityListCacheData {
	activities: ActivityListItem[];
	page: number;
	totalPages: number;
	totalCount: number;
	activityDraft?: string | null;
	mentionedUsers?: MentionedUsersMap;
}

/**
 * The messages-inbox payload cached under `/messages/inbox`.
 */
export interface MessagesListCacheData {
	conversations: ConversationListItem[];
	page: number;
	totalPages: number;
	totalCount: number;
}

/**
 * Per-scope search results cached under `('/search', scope)`. The
 * `(q, sort)` pair drives the freshness check (a change is a
 * stale-miss; the panel reloads).
 */
export interface SearchScopeCacheData {
	items: DiscussionSearchItem[] | ActivitySearchItem[] | MessageSearchItem[] | UserSearchItem[];
	page: number;
	totalPages: number;
	total: number;
	usedFallback: boolean;
	q: string;
	sort: SearchSort;
}
