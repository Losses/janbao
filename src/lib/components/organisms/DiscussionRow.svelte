<script lang="ts">
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { mdiStar, mdiStarOutline } from '@mdi/js';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import DateAtom from '$lib/components/atoms/Date.svelte';
	import Badge from '$lib/components/atoms/Badge.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import type { TranslationDict } from '$lib/types/translation';

	/**
	 * DiscussionRow Organism - Renders a discussion title, badges, bookmark star, and metadata.
	 */
	interface DiscussionRowItem {
		id: number;
		title: string;
		slug: string;
		authorId: number;
		authorDisplayName: string;
		authorUsername: string;
		authorAvatarFileId: string | null;
		viewCount: number;
		commentCount: number;
		isPinned: boolean;
		updatedAt: Date | string | number;
	}

	interface DiscussionReadHistory {
		lastReadAt: Date | string | number | null;
		lastReadPage: number;
		lastReadReplyId: number | null;
	}

	interface DiscussionRowProps {
		discussion: DiscussionRowItem;
		readHistory?: DiscussionReadHistory | null;
		isBookmarked?: boolean;
		unreadCount?: number;
		lastReplyAuthorDisplayName?: string | null;
		lastReplyAuthorId?: number | null;
		lastReplyAuthorUsername?: string | null;
		/** Translation dictionary */
		t?: TranslationDict | null;
		class?: string;
	}

	let {
		discussion,
		readHistory = null,
		isBookmarked = false,
		unreadCount = 0,
		lastReplyAuthorDisplayName = null,
		lastReplyAuthorId = null,
		lastReplyAuthorUsername = null,
		t = null,
		class: className = ''
	}: DiscussionRowProps = $props();

	// svelte-ignore state_referenced_locally
	let bookmarked = $state(isBookmarked);
	let loadingBookmark = $state(false);

	// Build exact URL based on reading history
	const discussionUrl = $derived.by(() => {
		const base = `/discussion/${discussion.id}/${discussion.slug}`;
		if (readHistory && readHistory.lastReadPage) {
			const pagePart = `p${readHistory.lastReadPage}`;
			const anchorPart = readHistory.lastReadReplyId ? `#reply-${readHistory.lastReadReplyId}` : '';
			return `${base}/${pagePart}${anchorPart}`;
		}
		return base;
	});

	const authorSlug = $derived(generateSlug(discussion.authorUsername || 'user'));
	const lastReplyAuthorSlug = $derived(generateSlug(lastReplyAuthorUsername || 'user'));

	// I18n translations with defaults
	const viewsText = $derived(t?.forum?.views ?? 'views');
	const repliesText = $derived(t?.forum?.replies ?? 'replies');
	const pinnedText = $derived(t?.forum?.pinned ?? 'PIN');

	async function toggleBookmark(e: Event) {
		e.preventDefault();
		e.stopPropagation();
		if (loadingBookmark) return;
		loadingBookmark = true;
		try {
			if (bookmarked) {
				const res = await fetch(`/api/bookmarks?discussionId=${discussion.id}`, {
					method: 'DELETE'
				});
				if (res.ok) {
					bookmarked = false;
				}
			} else {
				const res = await fetch(`/api/bookmarks`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discussionId: discussion.id })
				});
				if (res.ok) {
					bookmarked = true;
				}
			}
		} catch (err) {
			console.error('Failed to toggle bookmark:', err);
		} finally {
			loadingBookmark = false;
		}
	}
</script>

<div
	class="flex items-center gap-4 pl-3 pr-2 py-4 border-b border-base-300 transition-all hover:bg-base-200/20 {className} {unreadCount >
	0
		? 'bg-transparent'
		: 'bg-base-200'}"
>
	<!-- Left: User Avatar -->
	<a href="/profile/{discussion.authorId}/{authorSlug}" class="flex-shrink-0">
		<Avatar
			userId={discussion.authorId}
			avatarFileId={discussion.authorAvatarFileId}
			displayName={discussion.authorDisplayName}
			size="md"
		/>
	</a>

	<!-- Center: Title and Metadata -->
	<div class="flex-1 min-w-0">
		<div class="flex items-center gap-2 flex-wrap mb-1">
			<!-- Title -->
			<a
				href={discussionUrl}
				class="font-semibold text-lg hover:text-primary transition-colors hover:underline text-base-content break-words leading-snug"
			>
				{discussion.title}
			</a>
			{#if unreadCount > 0}
				<Badge variant="primary" class="font-bold">{unreadCount}</Badge>
			{/if}
		</div>

		<!-- Metadata: author, views, replies, last replier, updated date -->
		<div class="flex items-center gap-2 text-xs text-base-content/60 flex-wrap">
			{#if discussion.isPinned}
				<span
					class="bg-base-content text-base-100 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider text-[10px]"
				>
					{pinnedText}
				</span>
			{/if}

			<a
				href="/profile/{discussion.authorId}/{authorSlug}"
				class="hover:underline font-medium text-base-content/85"
			>
				{discussion.authorDisplayName}
			</a>

			<span class="text-base-content/30">•</span>
			<span>{discussion.viewCount} {viewsText}</span>
			<span class="text-base-content/30">•</span>
			<span>{discussion.commentCount} {repliesText}</span>

			{#if lastReplyAuthorDisplayName}
				<span class="text-base-content/30">•</span>
				<a
					href="/profile/{lastReplyAuthorId}/{lastReplyAuthorSlug}"
					class="hover:underline font-medium text-base-content/80">{lastReplyAuthorDisplayName}</a
				>
			{/if}

			<span class="text-base-content/30">•</span>
			<DateAtom value={discussion.updatedAt} {t} />
		</div>
	</div>

	<!-- Right: Star Bookmark Toggle -->
	<div class="flex-shrink-0">
		<button
			onclick={toggleBookmark}
			class="btn btn-ghost btn-circle btn-sm bookmark-btn {bookmarked
				? 'text-primary'
				: 'text-base-content/35 hover:text-primary'}"
			aria-label="Bookmark"
			disabled={loadingBookmark}
		>
			<Icon path={bookmarked ? mdiStar : mdiStarOutline} size={20} />
		</button>
	</div>
</div>
