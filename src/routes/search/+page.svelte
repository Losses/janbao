<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import Paginator from '$lib/components/atoms/Paginator.svelte';
	import { lexicalToSearchText } from '$lib/utils/lexical';
	import { formatTitle } from '$lib/utils/title';
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

	const SCOPES = ['discussions', 'activities', 'messages'];

	let { data }: PageProps = $props();

	const t = $derived(data.t);
	const tSearch = $derived(t.search);
	const query = $derived(data.query);
	const scope = $derived(data.scope);
	const currentPage = $derived(data.page);
	const totalPages = $derived(data.totalPages);
	const total = $derived(data.total);
	const usedFallback = $derived(data.usedFallback);

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

	function preview(contentJson: string): string {
		const text = lexicalToSearchText(contentJson);
		return text.length > 140 ? `${text.slice(0, 140)}…` : text;
	}
</script>

<svelte:head>
	<title>{formatTitle(tSearch.title)}</title>
</svelte:head>

<DualColumnLayout {t} user={data.user}>
	<div class="space-y-4 py-4">
		<h1 class="text-2xl font-bold">{tSearch.title}</h1>

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

		{#if usedFallback}
			<div class="text-xs text-warning">{tSearch.tooShortHint}</div>
		{/if}

		{#if query.trim().length === 0}
			<div class="p-8 text-center text-base-content/50">{tSearch.noQuery}</div>
		{:else if total === 0}
			<div class="p-8 text-center text-base-content/50">{tSearch.noResults}</div>
		{:else}
			<div class="text-sm text-base-content/60">{total} {tSearch.resultsLabel}</div>
			<div class="divide-y divide-base-300 border-y border-base-300">
				{#if scope === 'discussions' && data.discussions}
					{#each data.discussions as d (d.id)}
						<a href="/discussion/{d.id}/{d.slug}" class="block px-3 py-3 hover:bg-base-200">
							<div class="flex items-center justify-between gap-2">
								<span class="font-medium">{d.title}</span>
								<span class="badge badge-ghost badge-sm">
									{d.matchedField === 'title' ? tSearch.matchedTitle : tSearch.matchedBody}
								</span>
							</div>
							<div class="mt-1 text-sm text-base-content/60">
								{d.categoryTitle} · {d.authorDisplayName} · {d.commentCount}
							</div>
						</a>
					{/each}
				{:else if scope === 'activities' && data.activities}
					{#each data.activities as a (a.id)}
						<a
							href="/profile/{a.authorId}/{a.authorUsername}"
							class="block px-3 py-3 hover:bg-base-200"
						>
							<div class="text-sm text-base-content/60">{a.authorDisplayName}</div>
							<div class="mt-1 line-clamp-2">{preview(a.contentJson)}</div>
						</a>
					{/each}
				{:else if scope === 'messages' && data.messages}
					{#each data.messages as m (m.conversationId)}
						<a href="/messages/{m.conversationId}" class="block px-3 py-3 hover:bg-base-200">
							<div class="font-medium">{m.title}</div>
							<div class="mt-1 line-clamp-2 text-sm text-base-content/70">{m.previewText}</div>
							<div class="mt-1 text-xs text-base-content/50">
								{m.hitCount}
								{tSearch.resultsLabel}
							</div>
						</a>
					{/each}
				{/if}
			</div>

			{#if totalPages > 1}
				<div class="flex justify-end pt-2">
					<Paginator {currentPage} {totalPages} onPageChange={handlePageChange} {t} />
				</div>
			{/if}
		{/if}
	</div>
</DualColumnLayout>
