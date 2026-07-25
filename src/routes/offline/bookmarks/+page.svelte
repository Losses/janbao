<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import NavPipelineHost from '$lib/components/templates/NavPipelineHost.svelte';
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	// Importing the offline cache source module eagerly-registers it with the
	// singleton PageCacheStore as a side-effect, so the `ensure` call below
	// sees the IDB source in place on the first navigation.
	import '$lib/offline/offline-page-cache-source';
	import { getPageCacheStore } from '$lib/stores/page-cache.svelte';
	import type { OfflineBookmarkView } from '$lib/offline/types';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Cached bookmarks are read through the unified PageCacheStore: the
	// store's registered IDB source wraps `loadOfflineBookmarks` and is
	// consulted on the first `ensure` for `/offline/bookmarks`. The route is
	// server-rendered so the sidebar's logged-in state (user/t from the
	// layout) is embedded in the document; see $lib/offline/queries.ts.
	const pageCache = getPageCacheStore();
	let bookmarks = $state<OfflineBookmarkView[]>([]);
	let loading = $state(true);

	onMount(async () => {
		const entry = await pageCache.ensure(page.url.pathname, undefined);
		bookmarks = (entry?.data as OfflineBookmarkView[] | null) ?? [];
		loading = false;
	});
</script>

<svelte:head>
	<title>{formatTitle(data.t.bookmark.myBookmarks)}</title>
</svelte:head>

<DualColumnLayout t={data.t} user={data.user}>
	{#snippet sidebar()}{/snippet}

	<NavPipelineHost leftHref="/offline">
		<div class="space-y-3">
			<h1 class="page-title border-b border-base-300 pb-4">{data.t.bookmark.myBookmarks}</h1>
			{#if loading}
				<div class="flex items-center justify-center gap-2 py-10 text-sm text-base-content/50">
					<span class="loading loading-spinner loading-sm"></span>
					{data.t.common.loading}
				</div>
			{:else if bookmarks.length === 0}
				<EmptyState message={data.t.offline.reader.empty} bordered={false} />
			{:else}
				<div class="divide-y divide-base-300">
					{#each bookmarks as bookmark (bookmark.discussionId)}
						{@const authorSlug = generateSlug(bookmark.authorUsername || '')}
						<div class="py-3 px-0">
							<a
								href="/offline/{bookmark.discussionId}"
								class="font-semibold text-base-content hover:text-primary transition-colors block truncate"
							>
								{bookmark.title}
							</a>
							<p class="text-xs text-base-content/50 mt-1">
								{bookmark.categorySlug} ·
								<a href="/profile/{bookmark.authorId}/{authorSlug}" class="hover:underline">
									{bookmark.authorDisplayName}
								</a>
							</p>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</NavPipelineHost>
</DualColumnLayout>
