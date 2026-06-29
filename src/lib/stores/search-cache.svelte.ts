// src/lib/stores/search-cache.svelte.ts

import type {
	DiscussionSearchItem,
	ActivitySearchItem,
	MessageSearchItem,
	UserSearchItem,
	SearchSort
} from '$lib/server/db/dao/search';
import type { SearchScope } from '$lib/types/search';
import { isSearchEntryFresh } from '$lib/utils/search-fresh';

/**
 * Per-scope search-result cache. The `/search` load returns ONLY the active
 * scope's page; this cache holds each visited scope's last-fetched results so a
 * swipe back to a visited scope shows them instantly instead of refetching.
 *
 * Each entry stores its source `(q, sort)` so a query or sort change is detected
 * as a stale-miss (the entry is ignored and the panel reloads) - the cache never
 * serves results from an old query. Mirrors `list-cache.svelte.ts` (per-key core
 * shape + a generic populated check), generalised to the 4 search scopes with
 * typed setters per scope (no casts).
 */
interface SearchCacheCore<T> {
	items: T[];
	page: number;
	totalPages: number;
	total: number;
	usedFallback: boolean;
	q: string;
	sort: SearchSort;
}

export type SearchDiscussionsCache = SearchCacheCore<DiscussionSearchItem>;
export type SearchActivitiesCache = SearchCacheCore<ActivitySearchItem>;
export type SearchMessagesCache = SearchCacheCore<MessageSearchItem>;
export type SearchUsersCache = SearchCacheCore<UserSearchItem>;

interface SearchCacheState {
	discussions: SearchDiscussionsCache | null;
	activities: SearchActivitiesCache | null;
	messages: SearchMessagesCache | null;
	users: SearchUsersCache | null;
}

export class SearchCacheStore {
	#state = $state<SearchCacheState>({
		discussions: null,
		activities: null,
		messages: null,
		users: null
	});

	get discussions(): SearchDiscussionsCache | null {
		return this.#state.discussions;
	}

	get activities(): SearchActivitiesCache | null {
		return this.#state.activities;
	}

	get messages(): SearchMessagesCache | null {
		return this.#state.messages;
	}

	get users(): SearchUsersCache | null {
		return this.#state.users;
	}

	setDiscussions(input: SearchDiscussionsCache): void {
		this.#state.discussions = input;
	}

	setActivities(input: SearchActivitiesCache): void {
		this.#state.activities = input;
	}

	setMessages(input: SearchMessagesCache): void {
		this.#state.messages = input;
	}

	setUsers(input: SearchUsersCache): void {
		this.#state.users = input;
	}

	/** A cached entry is fresh only when its source `(q, sort)` matches the
	 *  current query - otherwise it is a stale miss and the panel reloads. */
	isFresh(scope: SearchScope, q: string, sort: SearchSort): boolean {
		switch (scope) {
			case 'discussions':
				return isSearchEntryFresh(this.#state.discussions, q, sort);
			case 'activities':
				return isSearchEntryFresh(this.#state.activities, q, sort);
			case 'messages':
				return isSearchEntryFresh(this.#state.messages, q, sort);
			case 'users':
				return isSearchEntryFresh(this.#state.users, q, sort);
		}
	}

	clear(): void {
		this.#state.discussions = null;
		this.#state.activities = null;
		this.#state.messages = null;
		this.#state.users = null;
	}
}

let searchCacheInstance: SearchCacheStore;

export function getSearchCacheStore(): SearchCacheStore {
	if (!searchCacheInstance) {
		searchCacheInstance = new SearchCacheStore();
	}
	return searchCacheInstance;
}
