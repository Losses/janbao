<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import UserInfoBlock from '$lib/components/molecules/UserInfoBlock.svelte';
	import ActivityList from '$lib/components/organisms/ActivityList.svelte';
	import EmptyState from '$lib/components/molecules/EmptyState.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{formatTitle(data.t.nav.activity)}</title>
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
		<h1 class="page-title">{data.t.nav.activity}</h1>
		{#if data.activities.length === 0}
			<EmptyState message={data.t.common.noResults} bordered={false} />
		{:else}
			<ActivityList items={data.activities} currentUserId={data.user?.id} t={data.t} />
		{/if}
	</div>
</DualColumnLayout>
