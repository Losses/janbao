<script lang="ts">
	import { page } from '$app/state';
	import type { TabPanelWrapperProps } from '$lib/types/tabs';
	import MessagesPanel from './MessagesPanel.svelte';

	let { cache, t }: TabPanelWrapperProps = $props();

	const conversations = $derived(cache.messages?.items ?? page.data.messages?.conversations);
	const currentPage = $derived(cache.messages?.page ?? page.data.messages?.page ?? 1);
	const totalPages = $derived(cache.messages?.totalPages ?? page.data.messages?.totalPages ?? 1);
</script>

<MessagesPanel conversations={conversations ?? []} {currentPage} {totalPages} {t} paginate={true} />
