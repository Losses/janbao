<script lang="ts">
	import { page } from '$app/state';
	import type { TabPanelWrapperProps } from '$lib/types/tabs';
	import ActivityPanel from './ActivityPanel.svelte';

	let { cache, t, user }: TabPanelWrapperProps = $props();

	const activities = $derived(cache.activity?.items ?? page.data.activity?.activities);
	const currentPage = $derived(cache.activity?.page ?? page.data.activity?.page ?? 1);
	const totalPages = $derived(cache.activity?.totalPages ?? page.data.activity?.totalPages ?? 1);
</script>

<ActivityPanel
	activities={activities ?? []}
	{currentPage}
	{totalPages}
	activityDraft={cache.activity?.activityDraft ?? null}
	mentionedUsers={cache.activity?.mentionedUsers ?? {}}
	{t}
	{user}
	paginate={true}
/>
