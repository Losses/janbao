<script lang="ts">
	import { page } from '$app/state';
	import type { TabPanelWrapperProps } from '$lib/types/tabs';
	import MessagesPanel from './MessagesPanel.svelte';

	let { cache, t }: TabPanelWrapperProps = $props();

	const conversations = $derived(cache.messages?.items ?? page.data.messages?.conversations);
</script>

<MessagesPanel
	conversations={conversations ?? []}
	currentPage={cache.messages?.page ?? 1}
	totalPages={cache.messages?.totalPages ?? 1}
	{t}
	paginate={true}
/>
