<script lang="ts">
	import type { TabPanelWrapperProps } from '$lib/types/tabs';
	import MessagesPanel from './MessagesPanel.svelte';

	let { cache, t }: TabPanelWrapperProps = $props();
</script>

<MessagesPanel
	conversations={cache.messages?.items ?? []}
	currentPage={cache.messages?.page ?? 1}
	totalPages={cache.messages?.totalPages ?? 1}
	{t}
	paginate={true}
/>
