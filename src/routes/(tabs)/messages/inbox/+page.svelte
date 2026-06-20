<script lang="ts">
	import DualColumnLayout from '$lib/components/templates/DualColumnLayout.svelte';
	import MessagesPanel from '$lib/components/panels/MessagesPanel.svelte';
	import MessagesSidebar from '$lib/components/panels/MessagesSidebar.svelte';
	import { formatTitle } from '$lib/utils/title';
	import type { ConversationListItem } from '$lib/types/api';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();

	const conversations = $derived(data.conversations as ConversationListItem[]);
</script>

<svelte:head>
	<title>{formatTitle(data.t.message.inbox)}</title>
</svelte:head>

<DualColumnLayout t={data.t} user={data.user}>
	{#snippet sidebar()}
		<MessagesSidebar t={data.t} user={data.user} />
	{/snippet}

	<MessagesPanel {conversations} currentPage={data.page} totalPages={data.totalPages} t={data.t} />
</DualColumnLayout>
