<script lang="ts">
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import Badge from '$lib/components/atoms/Badge.svelte';
	import BookmarkButton from '$lib/components/atoms/BookmarkButton.svelte';
	import DateAtom from '$lib/components/atoms/Date.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import type { TranslationDict } from '$lib/types/translation';
	import type { DiscussionRowItem, DiscussionReadHistory } from '$lib/types/discussion-row';

	/**
	 * DiscussionRow Organism - Renders a discussion title, badges, bookmark star, and metadata.
	 */
	interface DiscussionRowProps {
		discussion: DiscussionRowItem;
		readHistory?: DiscussionReadHistory | null;
		isBookmarked?: boolean;
		unreadCount?: number;
		lastReplyAuthorDisplayName?: string | null;
		lastReplyAuthorId?: number | null;
		lastReplyAuthorUsername?: string | null;
		/**
		 * Override the row's link target. Defaults to the online discussion URL
		 * (with a read-history deep link). The offline reader passes `/offline/{id}`
		 * so rows open the cached thread instead of hitting the network.
		 */
		discussionHref?: string;
		/**
		 * Whether to render the bookmark toggle. The offline reader has no server
		 * mutation path, so it hides the star; defaults to visible everywhere else.
		 */
		showBookmark?: boolean;
		/** Translation dictionary */
		t: TranslationDict;
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
		discussionHref,
		showBookmark = true,
		t,
		class: className = ''
	}: DiscussionRowProps = $props();

	// Build exact URL based on reading history. A caller-supplied discussionHref
	// (e.g. the offline reader) wins over the computed online URL.
	const discussionUrl = $derived.by(() => {
		if (discussionHref) return discussionHref;
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

	// I18n translations
	const viewsText = $derived(t.forum.views);
	const repliesText = $derived(t.forum.replies);
	const pinnedText = $derived(t.forum.pinned);
</script>

<div
	class="flex items-center gap-4 pl-3 pr-2 py-4 transition-all hover:bg-base-200/20 {className} {unreadCount >
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
				{#if unreadCount > 0}
					<Badge
						variant="primary"
						class="font-bold ml-1.5 align-middle -translate-y-[2px] no-underline"
						>{unreadCount}</Badge
					>
				{/if}
			</a>
		</div>

		<!-- Metadata: author, views, replies, last replier, updated date -->
		<div class="flex items-center gap-x-4 gap-y-2 text-xs text-base-content/60 flex-wrap">
			{#if discussion.isPinned}
				<span
					class="bg-base-content text-base-100 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider text-[10px]"
				>
					{pinnedText}
				</span>
			{/if}

			<a
				href="/profile/{discussion.authorId}/{authorSlug}"
				class="hover:underline font-medium text-base-content/60"
			>
				{discussion.authorDisplayName}
			</a>

			{#if discussion.viewCount !== undefined}
				<span>{discussion.viewCount} {viewsText}</span>
			{/if}
			<span>{discussion.commentCount} {repliesText}</span>

			{#if lastReplyAuthorDisplayName}
				<a
					href="/profile/{lastReplyAuthorId}/{lastReplyAuthorSlug}"
					class="hover:underline font-medium text-base-content/60">{lastReplyAuthorDisplayName}</a
				>
			{/if}

			<DateAtom value={discussion.lastReplyAt} {t} />
		</div>
	</div>

	<!-- Right: Star Bookmark Toggle (hidden where bookmarks can't be toggled, e.g. offline) -->
	{#if showBookmark}
		<BookmarkButton discussionId={discussion.id} bookmarked={isBookmarked} {t} />
	{/if}
</div>
