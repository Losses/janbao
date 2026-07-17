<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import ActivityPanel from '$lib/components/panels/ActivityPanel.svelte';
	import ActivitySidebar from '$lib/components/panels/ActivitySidebar.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	// Offline fallback: if we have a cached first page, swap to the client-only
	// /offline/activity reader so the feed is readable without a server
	// round-trip. (Mobile note: the pipeline tab host suppresses this page, so this only
	// runs on desktop; the offline reader remains reachable directly on mobile.)
	onMount(() => {
		if (navigator.onLine) return;
		void (async () => {
			const { getOfflineDB } = await import('$lib/offline/idb');
			const count = await getOfflineDB().activities.count();
			if (count > 0) await goto('/offline/activity');
		})();
	});
</script>

<svelte:head>
	<title>{formatTitle(data.t.nav.activity)}</title>
</svelte:head>

<DualColumnLayout t={data.t} user={data.user}>
	{#snippet sidebar()}
		<ActivitySidebar t={data.t} user={data.user} />
	{/snippet}

	<ActivityPanel
		activities={data.activities}
		currentPage={data.page}
		totalPages={data.totalPages}
		activityDraft={data.activityDraft}
		mentionedUsers={data.mentionedUsers}
		t={data.t}
		user={data.user}
	/>
</DualColumnLayout>
