// src/lib/stores/list-cache.svelte.ts

export interface CachedList<T = unknown> {
	discussions?: T[];
	activities?: T[];
	conversations?: T[];
	page: number;
	totalPages: number;
	totalCount: number;
	activityDraft?: string;
	mentionedUsers?: unknown[];
}

export interface HomeCacheData {
	discussions?: unknown[];
	page?: number;
	totalPages?: number;
	totalCount?: number;
}

export interface ActivityCacheData {
	activities?: unknown[];
	page?: number;
	totalPages?: number;
	totalCount?: number;
	activityDraft?: string;
	mentionedUsers?: unknown[];
}

export interface MessagesCacheData {
	conversations?: unknown[];
	page?: number;
	totalPages?: number;
	totalCount?: number;
}

class ListCacheStore {
	#home = $state<CachedList | null>(null);
	#activity = $state<CachedList | null>(null);
	#messages = $state<CachedList | null>(null);

	get home() {
		return this.#home;
	}

	get activity() {
		return this.#activity;
	}

	get messages() {
		return this.#messages;
	}

	setHome(data: HomeCacheData | null | undefined) {
		if (data && data.discussions) {
			this.#home = {
				discussions: data.discussions,
				page: data.page ?? 1,
				totalPages: data.totalPages ?? 1,
				totalCount: data.totalCount ?? 0
			};
		}
	}

	setActivity(data: ActivityCacheData | null | undefined) {
		if (data && data.activities) {
			this.#activity = {
				activities: data.activities,
				page: data.page ?? 1,
				totalPages: data.totalPages ?? 1,
				totalCount: data.totalCount ?? 0,
				activityDraft: data.activityDraft,
				mentionedUsers: data.mentionedUsers
			};
		}
	}

	setMessages(data: MessagesCacheData | null | undefined) {
		if (data && data.conversations) {
			this.#messages = {
				conversations: data.conversations,
				page: data.page ?? 1,
				totalPages: data.totalPages ?? 1,
				totalCount: data.totalCount ?? 0
			};
		}
	}
}

let listCacheInstance: ListCacheStore;

export function getListCacheStore(): ListCacheStore {
	if (!listCacheInstance) {
		listCacheInstance = new ListCacheStore();
	}
	return listCacheInstance;
}
