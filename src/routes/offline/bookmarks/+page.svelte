<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import { formatTitle } from '$lib/utils/title';
	import { generateSlug } from '$lib/utils/slug';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
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
		{#if data.bookmarks.length === 0}
			<EmptyState message={data.t.offline.reader.empty} bordered={false} />
		{:else}
			<div class="divide-y divide-base-300">
				{#each data.bookmarks as bookmark (bookmark.discussionId)}
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
