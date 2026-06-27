// src/lib/stores/list-cache.svelte.ts

import type { MobileTabLabelKey } from '$lib/utils/tab-config';
import type { DiscussionListItem } from '$lib/server/db/dao/discussions';
import type { ActivityListItem, ConversationListItem } from '$lib/types/api';
import type { MentionedUsersMap } from '$lib/types/mentions';

/**
 * Every tab's cached list shares one shape - `items` + pagination - keyed by the
 * tab's labelKey. Because the key IS the tab and the array field is always
 * `items`, "is this tab's cache populated?" is a single generic expression with
 * no per-tab switch (see isPopulated). Activity additionally keeps composer
 * state (draft / mentions) on its entry.
 */

interface TabCacheCore<T> {
	items: T[];
	page: number;
	totalPages: number;
	totalCount: number;
}

export type DiscussionsCacheData = TabCacheCore<DiscussionListItem>;
export interface ActivityCacheData extends TabCacheCore<ActivityListItem> {
	activityDraft?: string | null;
	mentionedUsers?: MentionedUsersMap;
}
export type MessagesCacheData = TabCacheCore<ConversationListItem>;

/** Setter inputs mirror the layout-load shape (per-tab array field names). */
export interface DiscussionsCacheInput {
	discussions?: DiscussionListItem[];
	page?: number;
	totalPages?: number;
	totalCount?: number;
}
export interface ActivityCacheInput {
	activities?: ActivityListItem[];
	page?: number;
	totalPages?: number;
	totalCount?: number;
	activityDraft?: string | null;
	mentionedUsers?: MentionedUsersMap;
}
export interface MessagesCacheInput {
	conversations?: ConversationListItem[];
	page?: number;
	totalPages?: number;
	totalCount?: number;
}

interface ListCacheState {
	discussions: DiscussionsCacheData | null;
	activity: ActivityCacheData | null;
	messages: MessagesCacheData | null;
}

export class ListCacheStore {
	#state = $state<ListCacheState>({
		discussions: null,
		activity: null,
		messages: null
	});

	get discussions() {
		return this.#state.discussions;
	}

	get activity() {
		return this.#state.activity;
	}

	get messages() {
		return this.#state.messages;
	}

	setDiscussions(data: DiscussionsCacheInput | null | undefined) {
		if (data?.discussions) {
			this.#state.discussions = {
				items: data.discussions,
				page: data.page ?? 1,
				totalPages: data.totalPages ?? 1,
				totalCount: data.totalCount ?? 0
			};
		}
	}

	setActivity(data: ActivityCacheInput | null | undefined) {
		if (data?.activities) {
			this.#state.activity = {
				items: data.activities,
				page: data.page ?? 1,
				totalPages: data.totalPages ?? 1,
				totalCount: data.totalCount ?? 0,
				activityDraft: data.activityDraft,
				mentionedUsers: data.mentionedUsers
			};
		}
	}

	setMessages(data: MessagesCacheInput | null | undefined) {
		if (data?.conversations) {
			this.#state.messages = {
				items: data.conversations,
				page: data.page ?? 1,
				totalPages: data.totalPages ?? 1,
				totalCount: data.totalCount ?? 0
			};
		}
	}

	/** Generic populated check - no per-tab switch: every slot exposes `items`. */
	isPopulated(labelKey: MobileTabLabelKey): boolean {
		return !!this.#state[labelKey]?.items.length;
	}
}

let listCacheInstance: ListCacheStore;

export function getListCacheStore(): ListCacheStore {
	if (!listCacheInstance) {
		listCacheInstance = new ListCacheStore();
	}
	return listCacheInstance;
}
