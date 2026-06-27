<script lang="ts">
	import type { TabPanelWrapperProps } from '$lib/types/tabs';
	import DiscussionsPanel from './DiscussionsPanel.svelte';

	let { cache, t }: TabPanelWrapperProps = $props();
</script>

<DiscussionsPanel
	discussions={cache.discussions?.items}
	currentPage={cache.discussions?.page ?? 1}
	totalPages={cache.discussions?.totalPages ?? 1}
	{t}
	buildPageUrl={(page) => (page === 1 ? '/' : `/discussions/p${page}`)}
	paginate={true}
/>
