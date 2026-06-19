<script lang="ts">
	import { onMount } from 'svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import { loadOfflineBookmarks } from '$lib/offline/queries';
	import type { OfflineBookmarkView } from '$lib/offline/types';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Cached bookmarks are read from IndexedDB after hydration. The route is
	// server-rendered so the sidebar's logged-in state (user/t from the layout)
	// is embedded in the document; see $lib/offline/queries.ts.
	let bookmarks = $state<OfflineBookmarkView[]>([]);
	let loading = $state(true);

	onMount(async () => {
		bookmarks = await loadOfflineBookmarks();
		loading = false;
	});
</script>

<svelte:head>
	<title>{formatTitle(data.t.bookmark.myBookmarks)}</title>
</svelte:head>

<DualColumnLayout t={data.t} user={data.user}>
	{#snippet sidebar()}
		{#if data.user}
			<div>
				<UserInfoBlock user={data.user} t={data.t} />
			</div>
		{/if}
	{/snippet}

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
</DualColumnLayout>
