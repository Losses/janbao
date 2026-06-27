<script lang="ts">
	import type { TabPanelWrapperProps } from '$lib/types/tabs';
	import ActivityPanel from './ActivityPanel.svelte';

	let { cache, t, user }: TabPanelWrapperProps = $props();
</script>

<ActivityPanel
	activities={cache.activity?.items ?? []}
	currentPage={cache.activity?.page ?? 1}
	totalPages={cache.activity?.totalPages ?? 1}
	activityDraft={cache.activity?.activityDraft ?? null}
	mentionedUsers={cache.activity?.mentionedUsers ?? {}}
	{t}
	{user}
	paginate={true}
/>
