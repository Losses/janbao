<script lang="ts">
	import { page } from '$app/state';
	import type { TabPanelWrapperProps } from '$lib/types/tabs';
	import ActivityPanel from './ActivityPanel.svelte';

	let { cache, t, user }: TabPanelWrapperProps = $props();

	const activities = $derived(cache.activity?.items ?? page.data.activity?.activities);
</script>

<ActivityPanel
	activities={activities ?? []}
	currentPage={cache.activity?.page ?? 1}
	totalPages={cache.activity?.totalPages ?? 1}
	activityDraft={cache.activity?.activityDraft ?? null}
	mentionedUsers={cache.activity?.mentionedUsers ?? {}}
	{t}
	{user}
	paginate={true}
/>
