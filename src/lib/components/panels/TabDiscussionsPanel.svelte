<script lang="ts">
	import { page } from '$app/state';
	import { getPageCacheStore } from '$lib/stores/page-cache.svelte';
	import type { DiscussionsListCacheData } from '$lib/types/page-cache-shapes';
	import DiscussionsPanel from './DiscussionsPanel.svelte';

	const cache = getPageCacheStore();
	const t = $derived(page.data.t);

	// The entry's data is opaque to the store; narrow it to this tab's
	// shape via the route-keyed lookup.
	const cached = $derived(cache.get('/')?.data as DiscussionsListCacheData | null | undefined);
	const discussions = $derived(cached?.discussions ?? page.data.home?.discussions);
	const currentPage = $derived(cached?.page ?? page.data.home?.page ?? 1);
	const totalPages = $derived(cached?.totalPages ?? page.data.home?.totalPages ?? 1);
</script>

<DiscussionsPanel
	{discussions}
	{currentPage}
	{totalPages}
	{t}
	buildPageUrl={(page) => (page === 1 ? '/' : `/discussions/p${page}`)}
	paginate={true}
/>
