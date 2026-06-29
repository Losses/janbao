/**
 * Shared search types. `SearchScope` and `SearchSort` are used by the search
 * route load, the scope pager, the cache store, the tab bar, and the sort sheet,
 * so they live here rather than in any one consumer. `SearchData` is the merged
 * page-data shape the search UI consumes (search-load fields plus the layout's
 * `t` / `user`).
 */
import type {
	DiscussionSearchItem,
	ActivitySearchItem,
	MessageSearchItem,
	UserSearchItem,
	SearchSort
} from '$lib/server/db/dao/search';
import type { UserInfoSummary } from '$lib/types/api';
import type { TranslationDict } from '$lib/types/translation';

export type { SearchSort };

export type SearchScope = 'discussions' | 'activities' | 'messages' | 'users';

export const SEARCH_SCOPES: readonly SearchScope[] = [
	'discussions',
	'activities',
	'messages',
	'users'
];

/** The result-item array for any scope (the active scope's slot from the load). */
export type SearchScopeItems =
	| DiscussionSearchItem[]
	| ActivitySearchItem[]
	| MessageSearchItem[]
	| UserSearchItem[];

export interface SearchData {
	query: string;
	scope: SearchScope;
	sort: SearchSort;
	page: number;
	totalPages: number;
	total: number;
	usedFallback: boolean;
	discussions: DiscussionSearchItem[] | null;
	activities: ActivitySearchItem[] | null;
	messages: MessageSearchItem[] | null;
	users: UserSearchItem[] | null;
	t: TranslationDict;
	user: UserInfoSummary | null;
}
