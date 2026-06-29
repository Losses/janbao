<script lang="ts">
	import { page } from '$app/state';
	import type { TabPanelWrapperProps } from '$lib/types/tabs';
	import DiscussionsPanel from './DiscussionsPanel.svelte';

	let { cache, t }: TabPanelWrapperProps = $props();

	const discussions = $derived(cache.discussions?.items ?? page.data.home?.discussions);
</script>

<DiscussionsPanel
	{discussions}
	currentPage={cache.discussions?.page ?? 1}
	totalPages={cache.discussions?.totalPages ?? 1}
	{t}
	buildPageUrl={(page) => (page === 1 ? '/' : `/discussions/p${page}`)}
	paginate={true}
/>
