<script lang="ts">
	import MessageCompose from '$lib/components/organisms/MessageCompose.svelte';
	import type { PageData } from './$types';

	interface PageProps {
		data: PageData;
	}

	let { data }: PageProps = $props();
</script>

<MessageCompose
	prefillRecipient={data.prefillRecipient}
	messageDraft={data.messageDraft}
	user={data.user}
	t={data.t}
/>
