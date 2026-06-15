<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import DateAtom from '$lib/components/atoms/Date.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import { mdiCommentOutline } from '@mdi/js';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { goto } from '$app/navigation';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	interface UrlOptions {
		scope?: string;
		page?: number;
	}

	interface HighlightSegment {
		text: string;
		match: boolean;
	}

	const SCOPES = ['discussions', 'activities', 'messages'];

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const tSearch = $derived(t.search);
	const query = $derived(data.query);
	const scope = $derived(data.scope);
	const user = $derived(data.user);
	const currentPage = $derived(data.page);
	const totalPages = $derived(data.totalPages);
	const total = $derived(data.total);

	function scopeLabel(s: string): string {
		if (s === 'activities') return tSearch.scopeActivities;
		if (s === 'messages') return tSearch.scopeMessages;
		return tSearch.scopeDiscussions;
	}

	function urlWith(opts: UrlOptions): string {
		const params = new SvelteURLSearchParams();
		if (query) params.set('q', query);
		params.set('scope', opts.scope ?? scope);
		if (opts.page !== undefined) params.set('page', String(opts.page));
		return `/search?${params.toString()}`;
	}

	function handlePageChange(newPage: number) {
		goto(urlWith({ page: newPage }));
	}

	/** Split text into matched/unmatched segments around occurrences of `q` (case-insensitive). */
	function highlightSegments(text: string, q: string): HighlightSegment[] {
		if (!q || !text) return [{ text, match: false }];
		const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
		const lower = q.toLowerCase();
		return parts
			.filter((p) => p.length > 0)
			.map((p) => ({ text: p, match: p.toLowerCase() === lower }));
	}

	/** Truncate to a window centered on the first match, so the highlighted term stays visible. */
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

<svelte:head>
	<title>{formatTitle(tSearch.title)}</title>
</svelte:head>

{#snippet sidebar()}
	<div class="space-y-4">
		{#if user}
			<UserInfoBlock {user} {t} />
		{:else}
			<div class="space-y-2">
				<h3 class="font-semibold text-sm text-base-content/70">{t.home.welcomeTo}</h3>
				<div class="flex gap-2">
					<a href="/entry/signin" class="btn btn-sm btn-primary flex-1">{t.nav.signin}</a>
					<a href="/entry/register" class="btn btn-sm btn-outline flex-1">{t.nav.register}</a>
				</div>
			</div>
		{/if}
	</div>
{/snippet}

<DualColumnLayout {sidebar} {t} {user}>
	<div class="space-y-3">
		<h1 class="text-2xl font-bold py-2">{tSearch.title}</h1>

		<!-- Scope selector (single-choice) -->
		<div class="flex flex-wrap gap-2">
			{#each SCOPES as s (s)}
				<a
					href={urlWith({ scope: s, page: 1 })}
					class="btn btn-sm {scope === s ? 'btn-primary' : 'btn-ghost'}"
					aria-current={scope === s ? 'page' : undefined}
				>
					{scopeLabel(s)}
				</a>
			{/each}
		</div>

		<!-- Search form (GET → /search?q=&scope=) -->
		<form method="GET" action="/search" class="flex gap-2">
			<input type="hidden" name="scope" value={scope} />
			<input
				type="text"
				name="q"
				value={query}
				placeholder={tSearch.placeholder}
				class="input input-bordered input-sm flex-1"
				autocomplete="off"
			/>
			<button type="submit" class="btn btn-sm btn-primary">{tSearch.searchBtn}</button>
		</form>

		{#if query.trim().length === 0}
			<div class="card bg-base-200/40 border border-base-300 p-10 text-center text-base-content/50">
				{tSearch.noQuery}
			</div>
		{:else if total === 0}
			<div class="card bg-base-200/40 border border-base-300 p-10 text-center text-base-content/50">
				{tSearch.noResults}
			</div>
		{:else}
			<div class="text-sm text-base-content/60">{total} {tSearch.resultsLabel}</div>
			<div class="bg-base-100 overflow-hidden">
				<div class="divide-y divide-base-300">
					{#if scope === 'discussions' && data.discussions}
						{#each data.discussions as d (d.id)}
							{@const authorSlug = generateSlug(d.authorUsername || 'user')}
							{@const dUrl =
								d.matchKind === 'reply' && d.bestReplyId !== null && d.replyPage !== null
									? `/discussion/${d.id}/${d.slug}/p${d.replyPage}#reply-${d.bestReplyId}`
									: `/discussion/${d.id}/${d.slug}`}
							<div class="flex items-start gap-4 pl-3 pr-2 py-4 hover:bg-base-200/20">
								<div class="relative flex-shrink-0">
									<a href="/profile/{d.authorId}/{authorSlug}">
										<Avatar
											userId={d.authorId}
											avatarFileId={d.authorAvatarFileId}
											displayName={d.authorDisplayName}
											size="md"
										/>
									</a>
									{#if d.matchKind === 'reply'}
										<span
											class="absolute -bottom-1 -right-1 badge badge-primary badge-xs flex items-center justify-center w-5 h-5 p-0"
											title={tSearch.matchedReply}
										>
											<Icon path={mdiCommentOutline} size={12} />
										</span>
									{/if}
								</div>
								<div class="flex-1 min-w-0">
									<a
										href={dUrl}
										class="font-semibold text-lg hover:text-primary hover:underline break-words leading-snug"
									>
										{#each highlightSegments(d.title, query) as seg, i (i)}{#if seg.match}<mark
													>{seg.text}</mark
												>{:else}{seg.text}{/if}{/each}
									</a>
									{#if d.bodyPreview}
										<a href={dUrl} class="block mt-1 text-sm text-base-content/70 line-clamp-2">
											{#each highlightSegments(contextPreview(d.bodyPreview, query), query) as seg, i (i)}{#if seg.match}<mark
														>{seg.text}</mark
													>{:else}{seg.text}{/if}{/each}
										</a>
									{/if}
									<div class="flex items-center gap-2 mt-1 text-xs text-base-content/60 flex-wrap">
										<a
											href="/profile/{d.authorId}/{authorSlug}"
											class="hover:underline font-medium text-base-content/85"
											>{d.authorDisplayName}</a
										>
										<span class="text-base-content/30">•</span>
										<span>{d.categoryTitle}</span>
										<span class="text-base-content/30">•</span>
										<span>{d.commentCount} {t.forum.replies}</span>
										<span class="text-base-content/30">•</span>
										<DateAtom value={d.createdAt} {t} />
									</div>
								</div>
							</div>
						{/each}
					{:else if scope === 'activities' && data.activities}
						{#each data.activities as a (a.id)}
							{@const authorSlug = generateSlug(a.authorUsername || 'user')}
							<div class="flex items-start gap-4 pl-3 pr-2 py-4 hover:bg-base-200/20">
								<a href="/profile/{a.authorId}/{authorSlug}" class="flex-shrink-0">
									<Avatar
										userId={a.authorId}
										avatarFileId={a.authorAvatarFileId}
										displayName={a.authorDisplayName}
										size="md"
									/>
								</a>
								<div class="flex-1 min-w-0">
									<a
										href="/profile/{a.authorId}/{authorSlug}"
										class="block text-sm font-medium text-base-content/85 hover:underline"
									>
										{a.authorDisplayName}
									</a>
									<div class="mt-1 text-sm text-base-content/80 line-clamp-3">
										{#each highlightSegments(contextPreview(a.previewText, query), query) as seg, i (i)}{#if seg.match}<mark
													>{seg.text}</mark
												>{:else}{seg.text}{/if}{/each}
									</div>
									<div class="mt-1 text-xs text-base-content/60">
										<DateAtom value={a.createdAt} {t} />
									</div>
								</div>
							</div>
						{/each}
					{:else if scope === 'messages' && data.messages}
						{#each data.messages as m (m.conversationId)}
							<a
								href="/messages/{m.conversationId}"
								class="flex items-start gap-4 pl-3 pr-2 py-4 hover:bg-base-200/20"
							>
								<div class="flex-1 min-w-0">
									<div class="font-semibold text-base-content hover:text-primary hover:underline">
										{#each highlightSegments(m.title, query) as seg, i (i)}{#if seg.match}<mark
													>{seg.text}</mark
												>{:else}{seg.text}{/if}{/each}
									</div>
									<div class="mt-1 text-sm text-base-content/70 line-clamp-2">
										{#each highlightSegments(contextPreview(m.previewText, query), query) as seg, i (i)}{#if seg.match}<mark
													>{seg.text}</mark
												>{:else}{seg.text}{/if}{/each}
									</div>
									<div class="mt-1 text-xs text-base-content/60">
										{m.hitCount}
										{tSearch.resultsLabel} • <DateAtom value={m.lastMessageAt} {t} />
									</div>
								</div>
							</a>
						{/each}
					{/if}
				</div>
			</div>

			{#if totalPages > 1}
				<div class="flex justify-end pt-2">
					<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
				</div>
			{/if}
		{/if}
	</div>
</DualColumnLayout>
