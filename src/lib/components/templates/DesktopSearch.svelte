<script lang="ts">
	/**
	 * DesktopSearch - the desktop `/search` surface (form + scope link-chips + sort
	 * `<select>` + the active scope's result list). Mobile `/search` uses
	 * `SearchScopePager` instead; this keeps the pre-DV08 desktop UX unchanged.
	 * Result rendering is the shared `SearchResultsList`.
	 */
	import { goto } from '$app/navigation';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import SearchResultsList from '$lib/components/molecules/SearchResultsList.svelte';
	import {
		SEARCH_SCOPES,
		type SearchData,
		type SearchScope,
		type SearchScopeItems,
		type SearchSort
	} from '$lib/types/search';
	import { searchScopeLabel } from '$lib/utils/search-label';

	interface DesktopSearchProps {
		data: SearchData;
	}

	let { data }: DesktopSearchProps = $props();

	const t = $derived(data.t);
	const tSearch = $derived(t.search);
	const online = getOnlineStore();

	interface UrlOptions {
		scope?: SearchScope;
		sort?: SearchSort;
		page?: number;
	}

	function urlWith(opts: UrlOptions): string {
		const params = new SvelteURLSearchParams();
		if (data.query) params.set('q', data.query);
		params.set('scope', opts.scope ?? data.scope);
		params.set('sort', opts.sort ?? data.sort);
		if (opts.page !== undefined) params.set('page', String(opts.page));
		return `/search?${params.toString()}`;
	}

	function onSortChange(event: Event): void {
		void goto(
			urlWith({ sort: (event.currentTarget as HTMLSelectElement).value as SearchSort, page: 1 }),
			{
				replaceState: true,
				noScroll: true
			}
		);
	}

	function onPageChange(p: number): void {
		void goto(urlWith({ page: p }), { replaceState: true, noScroll: true });
	}

	const activeItems = $derived.by((): SearchScopeItems | null => {
		switch (data.scope) {
			case 'discussions':
				return data.discussions;
			case 'activities':
				return data.activities;
			case 'messages':
				return data.messages;
			case 'users':
				return data.users;
		}
	});
</script>

<div class="space-y-3 p-3">
	<h1 class="page-title border-b border-base-300 pb-4">{tSearch.title}</h1>

	<div class="flex flex-wrap items-center gap-2">
		{#each SEARCH_SCOPES as s (s)}
			<a
				href={urlWith({ scope: s, page: 1 })}
				data-sveltekit-replacestate="yes"
				class="btn btn-sm {data.scope === s ? 'btn-primary' : 'btn-ghost'}"
				aria-current={data.scope === s ? 'page' : undefined}
			>
				{searchScopeLabel(s, tSearch)}
			</a>
		{/each}
		<select
			class="select select-bordered select-sm ml-auto w-fit"
			value={data.sort}
			aria-label={tSearch.sortBy}
			onchange={onSortChange}
		>
			<option value="newest">{tSearch.sortNewest}</option>
			<option value="oldest">{tSearch.sortOldest}</option>
			<option value="relevance">{tSearch.sortRelevance}</option>
			{#if data.scope === 'discussions'}
				<option value="replies">{tSearch.sortReplies}</option>
			{/if}
		</select>
	</div>

	<form method="GET" action="/search" class="flex gap-2">
		<input type="hidden" name="scope" value={data.scope} />
		<input
			type="text"
			name="q"
			value={data.query}
			placeholder={tSearch.placeholder}
			class="input input-bordered input-sm flex-1"
			autocomplete="off"
		/>
		<button type="submit" class="btn btn-sm btn-primary">{tSearch.searchBtn}</button>
	</form>

	<SearchResultsList
		scope={data.scope}
		items={activeItems}
		query={data.query}
		page={data.page}
		totalPages={data.totalPages}
		total={data.total}
		online={online.online}
		{t}
		{onPageChange}
	/>
</div>
