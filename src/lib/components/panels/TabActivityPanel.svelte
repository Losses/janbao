<script lang="ts">
	import { page } from '$app/state';
	import { getListCacheStore } from '$lib/stores/list-cache.svelte';
	import ActivityPanel from './ActivityPanel.svelte';

	const cache = getListCacheStore();
	const t = $derived(page.data.t);
	const user = $derived(page.data.user);

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
