/**
 * Caches the DATA (not rendered HTML) of the last-viewed deep page (a thread)
 * so the MobileTabPager can render a REAL Svelte component preview during a
 * back-swipe. This replaces the previous {@html} approach which failed because
 * Svelte's scoped CSS is removed from <head> when the page unmounts, and the
 * html.fixed-viewport-gated layout rules don't apply in the pager context.
 *
 * Same singleton pattern as ListCacheStore. The data is the thread page's
 * PageData: plain serializable objects already loaded by +page.server.ts.
 * A ThreadPreviewPanel component renders from this data with full scoped CSS.
 */
import type { MentionedUsersMap } from '$lib/types/mentions';
import type { TranslationDict } from '$lib/types/translation';
import type { UserInfoSummary } from '$lib/types/api';

export interface ThreadReplyData {
	id: number;
	contentJson: string;
	createdAt: Date;
	updatedAt: Date;
	editedAt: Date | null;
	editedBy: number | null;
	editedByDisplayName: string | null;
	editedByUsername: string | null;
	authorId: number;
	authorDisplayName: string;
	authorUsername: string;
	authorAvatarUrl: string | null;
}

export interface ThreadDiscussionData {
	id: number;
	title: string;
	slug: string;
	categorySlug: string;
	isPinned: boolean;
	isBookmarked: number;
}

export interface ThreadPreviewData {
	pathname: string;
	discussion: ThreadDiscussionData;
	opReply: ThreadReplyData | null;
	replies: ThreadReplyData[];
	mentionedUsers: MentionedUsersMap;
	t: TranslationDict;
	user: UserInfoSummary | null;
	theme: string | null;
	scrollTop: number;
}

class DeepPageSnapshotStore {
	#data = $state<ThreadPreviewData | null>(null);

	get data(): ThreadPreviewData | null {
		return this.#data;
	}

	get hasSnapshot(): boolean {
		return this.#data !== null;
	}

	get pathname(): string | null {
		return this.#data?.pathname ?? null;
	}

	get scrollTop(): number {
		return this.#data?.scrollTop ?? 0;
	}

	capture(data: ThreadPreviewData): void {
		this.#data = data;
	}

	clear(): void {
		this.#data = null;
	}
}

let instance: DeepPageSnapshotStore | undefined;

export function getDeepPageSnapshotStore(): DeepPageSnapshotStore {
	if (!instance) instance = new DeepPageSnapshotStore();
	return instance;
}
