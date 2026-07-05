<script lang="ts">
	import { page } from '$app/state';
	import { getPageCacheStore } from '$lib/stores/page-cache.svelte';
	import type { ActivityListCacheData } from '$lib/types/page-cache-shapes';
	import ActivityPanel from './ActivityPanel.svelte';

	const cache = getPageCacheStore();
	const t = $derived(page.data.t);
	const user = $derived(page.data.user);

	// The entry's data is opaque to the store; narrow it to this tab's
	// shape via the route-keyed lookup.
	const cached = $derived(cache.get('/activity')?.data as ActivityListCacheData | null | undefined);
	const activities = $derived(cached?.activities ?? page.data.activity?.activities);
	const currentPage = $derived(cached?.page ?? page.data.activity?.page ?? 1);
	const totalPages = $derived(cached?.totalPages ?? page.data.activity?.totalPages ?? 1);
</script>

<ActivityPanel
	activities={activities ?? []}
	{currentPage}
	{totalPages}
	activityDraft={cached?.activityDraft ?? null}
	mentionedUsers={cached?.mentionedUsers ?? {}}
	{t}
	{user}
	paginate={true}
/>
