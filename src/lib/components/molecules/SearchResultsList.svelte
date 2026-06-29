<script lang="ts">
	/**
	 * SearchResultsList - renders ONE search scope's result list (offline /
	 * no-query / no-results / results + paginator). Shared by the mobile scope
	 * pager (4 panels) and the desktop search surface (the active scope), so the
	 * per-scope markup lives in one place.
	 *
	 * `items` is the active scope's result array (a union); the scope switch
	 * narrows it to the typed array each block renders.
	 */
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import OfflinePlaceholder from '$lib/components/molecules/OfflinePlaceholder.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import DateAtom from '$lib/components/atoms/Date.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { mdiCommentOutline } from '@mdi/js';
	import { generateSlug } from '$lib/utils/slug';
	import { formatDisplayName } from '$lib/utils/user';
	import type { SearchScope, SearchScopeItems } from '$lib/types/search';
	import type {
		DiscussionSearchItem,
		ActivitySearchItem,
		MessageSearchItem,
		UserSearchItem
	} from '$lib/server/db/dao/search';
	import type { TranslationDict } from '$lib/types/translation';
	import type { PageChangeHandler } from '$lib/types/handlers';

	interface SearchResultsListProps {
		scope: SearchScope;
		items: SearchScopeItems | null;
		query: string;
		page: number;
		totalPages: number;
		total: number;
		online: boolean;
		t: TranslationDict;
		onPageChange: PageChangeHandler;
	}

	let {
		scope,
		items,
		query,
		page,
		totalPages,
		total,
		online,
		t,
		onPageChange
	}: SearchResultsListProps = $props();

	const tSearch = $derived(t.search);
	const hasQuery = $derived(query.trim().length > 0);
	const hasItems = $derived(!!items && items.length > 0);

	interface HighlightSegment {
		text: string;
		match: boolean;
	}

	function highlightSegments(text: string, q: string): HighlightSegment[] {
		if (!q || !text) return [{ text, match: false }];
		const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
		const lower = q.toLowerCase();
		return parts
			.filter((p) => p.length > 0)
			.map((p) => ({ text: p, match: p.toLowerCase() === lower }));
	}

	function contextPreview(text: string, q: string): string {
		const max = 160;
		if (text.length <= max) return text;
		const idx = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
		if (idx < 0) return `${text.slice(0, max).trimEnd()}…`;
		const start = Math.max(0, idx - 60);
		const end = Math.min(text.length, idx + q.length + 80);
		return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
	}
</script>

{#if !online}
	<OfflinePlaceholder {t} bordered={false} />
{:else if !hasQuery}
	<EmptyState message={tSearch.noQuery} />
{:else if !hasItems}
	<EmptyState message={tSearch.noResults} />
{:else}
	<div class="text-sm text-base-content/60">{total} {tSearch.resultsLabel}</div>
	<div class="mt-2 bg-base-100 overflow-hidden">
		<div class="divide-y divide-base-300">
			{#if scope === 'discussions'}
				{@const discussions = items as DiscussionSearchItem[]}
				{#each discussions as item (item.id)}
					{@const authorSlug = generateSlug(item.authorUsername || 'user')}
					{@const dUrl =
						item.matchKind === 'reply' && item.bestReplyId !== null && item.replyPage !== null
							? `/discussion/${item.id}/${item.slug}/p${item.replyPage}#reply-${item.bestReplyId}`
							: `/discussion/${item.id}/${item.slug}`}
					{@const authorDisplayName = formatDisplayName(item.authorDisplayName, item.authorId, t)}
					<div class="flex items-start gap-4 py-4 pl-3 pr-2">
						<div class="relative flex-shrink-0">
							<a href="/profile/{item.authorId}/{authorSlug}">
								<Avatar
									avatarUrl={item.authorAvatarUrl}
									displayName={authorDisplayName}
									size="md"
								/>
							</a>
							{#if item.matchKind === 'reply'}
								<span
									class="badge badge-primary badge-xs absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center p-0"
									title={tSearch.matchedReply}
								>
									<Icon path={mdiCommentOutline} size={12} />
								</span>
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<a
								href={dUrl}
								class="break-words text-lg font-semibold leading-snug hover:text-primary hover:underline"
							>
								{#each highlightSegments(item.title, query) as seg, i (i)}{#if seg.match}<mark
											>{seg.text}</mark
										>{:else}{seg.text}{/if}{/each}
							</a>
							{#if item.bodyPreview}
								<a href={dUrl} class="mt-1 block line-clamp-2 text-sm text-base-content/70">
									{#each highlightSegments(contextPreview(item.bodyPreview, query), query) as seg, i (i)}{#if seg.match}<mark
												>{seg.text}</mark
											>{:else}{seg.text}{/if}{/each}
								</a>
							{/if}
						</div>
					</div>
				{/each}
			{:else if scope === 'activities'}
				{@const activities = items as ActivitySearchItem[]}
				{#each activities as item (item.id)}
					{@const authorSlug = generateSlug(item.authorUsername || 'user')}
					{@const authorDisplayName = formatDisplayName(item.authorDisplayName, item.authorId, t)}
					<div class="flex items-start gap-4 py-4 pl-3 pr-2">
						<a href="/profile/{item.authorId}/{authorSlug}" class="flex-shrink-0">
							<Avatar avatarUrl={item.authorAvatarUrl} displayName={authorDisplayName} size="md" />
						</a>
						<div class="min-w-0 flex-1">
							<a
								href="/profile/{item.authorId}/{authorSlug}"
								class="block text-sm font-medium text-base-content/85 hover:underline"
							>
								{authorDisplayName}
							</a>
							<div class="mt-1 line-clamp-3 text-sm text-base-content/80">
								{#each highlightSegments(contextPreview(item.previewText, query), query) as seg, i (i)}{#if seg.match}<mark
											>{seg.text}</mark
										>{:else}{seg.text}{/if}{/each}
							</div>
							<div class="mt-1 text-xs text-base-content/60">
								<DateAtom value={item.createdAt} {t} />
							</div>
						</div>
					</div>
				{/each}
			{:else if scope === 'messages'}
				{@const messages = items as MessageSearchItem[]}
				{#each messages as item (item.conversationId)}
					<a href="/messages/{item.conversationId}" class="flex items-start gap-4 py-4 pl-3 pr-2">
						<div class="min-w-0 flex-1">
							<div class="font-semibold text-base-content hover:text-primary hover:underline">
								{#each highlightSegments(item.title, query) as seg, i (i)}{#if seg.match}<mark
											>{seg.text}</mark
										>{:else}{seg.text}{/if}{/each}
							</div>
							<div class="mt-1 line-clamp-2 text-sm text-base-content/70">
								{#each highlightSegments(contextPreview(item.previewText, query), query) as seg, i (i)}{#if seg.match}<mark
											>{seg.text}</mark
										>{:else}{seg.text}{/if}{/each}
							</div>
							<div class="mt-1 text-xs text-base-content/60">
								{item.hitCount}
								{tSearch.resultsLabel} • <DateAtom value={item.lastMessageAt} {t} />
							</div>
						</div>
					</a>
				{/each}
			{:else if scope === 'users'}
				{@const users = items as UserSearchItem[]}
				{#each users as item (item.id)}
					{@const userSlug = generateSlug(item.username || 'user')}
					{@const userDisplayName = formatDisplayName(item.displayName, item.id, t)}
					{@const profileUrl = `/profile/${item.id}/${userSlug}`}
					<div class="flex items-start gap-4 py-4 pl-3 pr-2">
						<a href={profileUrl} class="flex-shrink-0">
							<Avatar avatarUrl={item.avatarUrl} displayName={userDisplayName} size="md" />
						</a>
						<div class="min-w-0 flex-1">
							<a href={profileUrl} class="block hover:underline">
								<span class="font-semibold text-base-content">
									{#each highlightSegments(item.displayName, query) as seg, i (i)}{#if seg.match}<mark
												>{seg.text}</mark
											>{:else}{seg.text}{/if}{/each}
								</span>
								<span class="ml-1 text-sm text-base-content/60"
									>@{#each highlightSegments(item.username, query) as seg, i (i)}{#if seg.match}<mark
												>{seg.text}</mark
											>{:else}{seg.text}{/if}{/each}</span
								>
							</a>
							{#if item.bio}
								<div class="mt-1 line-clamp-2 text-sm text-base-content/80">
									{#each highlightSegments(contextPreview(item.bio, query), query) as seg, i (i)}{#if seg.match}<mark
												>{seg.text}</mark
											>{:else}{seg.text}{/if}{/each}
								</div>
							{/if}
							<div class="mt-1 text-xs text-base-content/60">
								<DateAtom value={item.signupTime} {t} />
							</div>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
	{#if totalPages > 1}
		<div class="flex justify-end pt-2">
			<Paginator {totalPages} {onPageChange} {t} currentPage={page} />
		</div>
	{/if}
{/if}
