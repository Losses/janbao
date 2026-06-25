<script lang="ts">
	/**
	 * MessagesPanel - Content-only inbox (conversation cards + paginator). No
	 * chrome; shared by the messages route (desktop) and the mobile tab pager.
	 */
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import Badge from '$lib/components/atoms/Badge.svelte';
	import DateComponent from '$lib/components/atoms/Date.svelte';
	import { goto } from '$app/navigation';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import type { ConversationListItem } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	interface MessagesPanelProps {
		conversations: ConversationListItem[];
		currentPage: number;
		totalPages: number;
		t: TranslationDict;
		/** Show the paginator. Desktop always; mobile pager only on the active panel. */
		paginate?: boolean;
	}

	let { conversations, currentPage, totalPages, t, paginate = true }: MessagesPanelProps = $props();

	const online = getOnlineStore();
	const messageT = $derived(t.message);

	function handlePageChange(newPage: number) {
		goto(`?page=${newPage}`);
	}
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between border-b border-base-300 pb-4">
		<h1 class="page-title">{messageT.inbox}</h1>
		{#if online.online}
			<a href="/messages/new" class="btn btn-primary btn-sm">{messageT.newMessage}</a>
		{:else}
			<span class="text-xs text-base-content/50">{t.offline.disabled.title}</span>
		{/if}
	</div>

	{#if !online.online || conversations.length === 0}
		<EmptyState message={!online.online ? t.offline.disabled.title : messageT.noConversations} />
	{:else}
		<!-- Conversation stream - mirrors the homepage discussion list:
		avatar left, content right, divide-y rows, no card chrome. -->
		<div class="overflow-hidden bg-base-100">
			<div class="divide-y divide-base-300">
				{#each conversations as conv (conv.id)}
					{@const authorSlug = generateSlug(conv.lastAuthorUsername || 'user')}
					{@const authorHref =
						conv.lastAuthorId !== null ? `/profile/${conv.lastAuthorId}/${authorSlug}` : null}
					<div class="flex items-start gap-4 py-4 transition-all hover:bg-base-200/20">
						<!-- Left: last author avatar → profile -->
						<div class="flex-shrink-0">
							{#if authorHref}
								<a href={authorHref}>
									<Avatar
										avatarUrl={conv.lastAuthorAvatarUrl}
										displayName={conv.lastAuthorDisplayName}
										size="md"
									/>
								</a>
							{:else}
								<Avatar displayName="?" size="md" />
							{/if}
						</div>

						<!-- Right: username, title, meta -->
						<div class="min-w-0 flex-1">
							{#if authorHref}
								<a
									href={authorHref}
									class="inline-block text-sm font-medium text-base-content/85 hover:text-primary hover:underline"
								>
									{conv.lastAuthorUsername}
								</a>
							{/if}

							<div class="flex flex-wrap items-center gap-2">
								<a
									href="/messages/{conv.id}"
									class="break-words text-lg font-semibold leading-snug text-base-content transition-colors hover:text-primary hover:underline"
								>
									{conv.title}
									{#if conv.unreadCount > 0}
										<Badge
											variant="primary"
											class="ml-1.5 -translate-y-[2px] align-middle font-bold no-underline"
											>{conv.unreadCount}</Badge
										>
									{/if}
								</a>
							</div>

							{#if conv.lastMessagePreview}
								<a
									href="/messages/{conv.id}"
									class="mt-1 block break-words text-sm text-base-content/60 line-clamp-3 hover:text-primary"
								>
									{conv.lastMessagePreview}
								</a>
							{/if}

							<div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-base-content/60">
								<span>{conv.messageCount} {messageT.messages}</span>
								<span class="text-base-content/30">•</span>
								{#if conv.lastMessageAt}
									<DateComponent value={conv.lastMessageAt} {t} />
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>

		{#if paginate && totalPages > 1}
			<div class="flex justify-end pt-2">
				<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
			</div>
		{/if}
	{/if}
</div>
