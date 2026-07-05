<script lang="ts">
	import { page } from '$app/state';
	import { getPageCacheStore } from '$lib/stores/page-cache.svelte';
	import type { MessagesListCacheData } from '$lib/types/page-cache-shapes';
	import MessagesPanel from './MessagesPanel.svelte';

	const cache = getPageCacheStore();
	const t = $derived(page.data.t);

	// The entry's data is opaque to the store; narrow it to this tab's
	// shape via the route-keyed lookup.
	const cached = $derived(
		cache.get('/messages/inbox')?.data as MessagesListCacheData | null | undefined
	);
	const conversations = $derived(cached?.conversations ?? page.data.messages?.conversations);
	const currentPage = $derived(cached?.page ?? page.data.messages?.page ?? 1);
	const totalPages = $derived(cached?.totalPages ?? page.data.messages?.totalPages ?? 1);
</script>

<MessagesPanel conversations={conversations ?? []} {currentPage} {totalPages} {t} paginate={true} />
