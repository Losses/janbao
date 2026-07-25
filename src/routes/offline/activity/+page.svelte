<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import NavPipelineHost from '$lib/components/templates/NavPipelineHost.svelte';
	import ActivityList from '$lib/components/organisms/ActivityList.svelte';
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import { formatTitle } from '$lib/utils/title';
	// Importing the offline cache source module eagerly-registers it with the
	// singleton PageCacheStore as a side-effect, so the `ensure` call below
	// sees the IDB source in place on the first navigation.
	import '$lib/offline/offline-page-cache-source';
	import { getPageCacheStore } from '$lib/stores/page-cache.svelte';
	import type { ActivityListItem } from '$lib/types/api';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Cached activity feed is read through the unified PageCacheStore: the
	// store's registered IDB source wraps `loadOfflineActivity` and is
	// consulted on the first `ensure` for `/offline/activity`. The route is
	// server-rendered so the sidebar's logged-in state (user/t from the
	// layout) is embedded in the document; see $lib/offline/queries.ts.
	const pageCache = getPageCacheStore();
	let activities = $state<ActivityListItem[]>([]);
	let loading = $state(true);

	onMount(async () => {
		const entry = await pageCache.ensure(page.url.pathname, undefined);
		activities = (entry?.data as ActivityListItem[] | null) ?? [];
		loading = false;
	});
</script>

<svelte:head>
	<title>{formatTitle(data.t.nav.activity)}</title>
</svelte:head>

<DualColumnLayout t={data.t} user={data.user}>
	{#snippet sidebar()}{/snippet}

	<NavPipelineHost leftHref="/activity">
		<div class="space-y-3">
			<h1 class="page-title">{data.t.nav.activity}</h1>
			{#if loading}
				<div class="flex items-center justify-center gap-2 py-10 text-sm text-base-content/50">
					<span class="loading loading-spinner loading-sm"></span>
					{data.t.common.loading}
				</div>
			{:else if activities.length === 0}
				<EmptyState message={data.t.common.noResults} bordered={false} />
			{:else}
				<ActivityList items={activities} currentUserId={data.user?.id} t={data.t} />
			{/if}
		</div>
	</NavPipelineHost>
</DualColumnLayout>
