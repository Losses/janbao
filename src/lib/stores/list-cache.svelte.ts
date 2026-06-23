// src/lib/stores/list-cache.svelte.ts

import type { DiscussionListItem } from '$lib/server/db/dao/discussions';
import type { ActivityListItem } from '$lib/types/api';
import type { MentionedUsersMap } from '$lib/types/mentions';

export interface HomeCacheInput {
	discussions?: DiscussionListItem[];
	page?: number;
	totalPages?: number;
	totalCount?: number;
}

export interface HomeCacheData {
	discussions: DiscussionListItem[];
	page: number;
	totalPages: number;
	totalCount: number;
}

export interface ActivityCacheInput {
	activities?: ActivityListItem[];
	page?: number;
	totalPages?: number;
	totalCount?: number;
	activityDraft?: string | null;
	mentionedUsers?: MentionedUsersMap;
}

export interface ActivityCacheData {
	activities: ActivityListItem[];
	page: number;
	totalPages: number;
	totalCount: number;
	activityDraft?: string | null;
	mentionedUsers?: MentionedUsersMap;
}

export interface MessagesCacheInput {
	conversations?: unknown[];
	page?: number;
	totalPages?: number;
	totalCount?: number;
}

export interface MessagesCacheData {
	conversations: unknown[];
	page: number;
	totalPages: number;
	totalCount: number;
}

class ListCacheStore {
	#home = $state<HomeCacheData | null>(null);
	#activity = $state<ActivityCacheData | null>(null);
	#messages = $state<MessagesCacheData | null>(null);

	get home() {
		return this.#home;
	}

	get activity() {
		return this.#activity;
	}

	get messages() {
		return this.#messages;
	}

	setHome(data: HomeCacheInput | null | undefined) {
		if (data && data.discussions) {
			this.#home = {
				discussions: data.discussions,
				page: data.page ?? 1,
				totalPages: data.totalPages ?? 1,
				totalCount: data.totalCount ?? 0
			};
		}
	}

	setActivity(data: ActivityCacheInput | null | undefined) {
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

	setMessages(data: MessagesCacheInput | null | undefined) {
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
