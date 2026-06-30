<script lang="ts">
	import { page } from '$app/state';
	import { getListCacheStore } from '$lib/stores/list-cache.svelte';
	import DiscussionsPanel from './DiscussionsPanel.svelte';

	const cache = getListCacheStore();
	const t = $derived(page.data.t);

	const discussions = $derived(cache.discussions?.items ?? page.data.home?.discussions);
	const currentPage = $derived(cache.discussions?.page ?? page.data.home?.page ?? 1);
	const totalPages = $derived(cache.discussions?.totalPages ?? page.data.home?.totalPages ?? 1);
</script>

<DiscussionsPanel
	{discussions}
	{currentPage}
	{totalPages}
	{t}
	buildPageUrl={(page) => (page === 1 ? '/' : `/discussions/p${page}`)}
	paginate={true}
/>
