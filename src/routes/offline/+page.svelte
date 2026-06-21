<script lang="ts">
	import { onMount } from 'svelte';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import DiscussionRow from '$lib/components/organisms/DiscussionRow.svelte';
	import { generateSlug } from '$lib/utils/slug';
	import { loadOfflineDiscussions, mapOfflineDiscussionRow } from '$lib/offline/queries';
	import type { OfflineDiscussionView } from '$lib/offline/types';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Cached content is read from IndexedDB after hydration (client-only). The
	// route itself is server-rendered, so the layout's user/t - and therefore the
	// sidebar's logged-in state - are embedded in the document and survive a
	// direct load / offline navigation. See $lib/offline/queries.ts.
	let discussions = $state<OfflineDiscussionView[]>([]);
	let loading = $state(true);

	onMount(async () => {
		discussions = await loadOfflineDiscussions();
		loading = false;
	});

	const unknownUser = $derived(data.t.offline.reader.unknownUser);
</script>

<svelte:head>
	<title>Janbao</title>
</svelte:head>

{#snippet sidebar()}
	<div class="space-y-4">
		{#if data.user}
			<div class="flex flex-col gap-2">
				<a
					class="btn btn-outline btn-sm w-full"
					href="/profile/discussions/{data.user.id}/{generateSlug(data.user.username)}"
				>
					{data.t.sidebar.myDiscussions}
				</a>
				<a class="btn btn-outline btn-sm w-full" href="/drafts">
					{data.t.sidebar.myDrafts}
				</a>
			</div>
		{/if}
	</div>
{/snippet}

<DualColumnLayout t={data.t} user={data.user} {sidebar}>
	<div class="space-y-3">
		{#if loading}
			<div class="flex items-center justify-center gap-2 py-10 text-sm text-base-content/50">
				<span class="loading loading-spinner loading-sm"></span>
				{data.t.common.loading}
			</div>
		{:else if discussions.length === 0}
			<EmptyState message={data.t.offline.reader.empty} bordered={false} />
		{:else}
			<!-- Same wrapper + row component as the home page (DiscussionListPage)
			     so the offline list stays pixel-aligned with the online front page.
			     Rows link to the offline reader and omit the bookmark star. -->
			<div class="bg-base-100 overflow-hidden border-t border-b border-base-300">
				<div class="divide-y divide-base-300">
					{#each discussions as d (d.id)}
						<DiscussionRow
							discussion={mapOfflineDiscussionRow(d, unknownUser)}
							discussionHref={`/offline/${d.id}`}
							showBookmark={false}
							t={data.t}
						/>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</DualColumnLayout>
