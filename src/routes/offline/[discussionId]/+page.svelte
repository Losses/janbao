<script lang="ts">
	import { onMount } from 'svelte';
	import LexicalRenderer from '$lib/components/molecules/LexicalRenderer.svelte';
	import { recordOfflineRead } from '$lib/offline/read-state';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Record this offline read into the local outbox; it syncs back to the server
	// (last-write-wins) on reconnect without touching the online read mechanism.
	onMount(() => {
		const disc = data.discussion;
		if (!disc) return;
		const last = data.replies.length > 0 ? data.replies[data.replies.length - 1] : null;
		void recordOfflineRead(disc.id, last?.id ?? null, 1);
	});
</script>

<svelte:head>
	<title>{data.discussion?.title ?? data.t.offline.reader.listTitle} · Janbao</title>
</svelte:head>

<div class="space-y-4">
	<a class="link link-hover text-sm" href="/offline">← {data.t.offline.reader.backToList}</a>

	{#if data.discussion}
		<div class="flex items-center gap-2">
			<h1 class="text-xl font-semibold">{data.discussion.title}</h1>
			<span class="badge badge-sm">{data.t.offline.reader.readerBadge}</span>
		</div>

		{#if data.replies.length === 0}
			<p class="text-sm opacity-70">{data.t.offline.reader.empty}</p>
		{:else}
			<div class="space-y-6">
				{#each data.replies as reply (reply.id)}
					<article class="prose prose-sm max-w-none">
						<LexicalRenderer contentJson={reply.contentJson} t={data.t} />
					</article>
				{/each}
			</div>
		{/if}
	{:else}
		<p class="text-sm opacity-70">{data.t.offline.reader.notCached}</p>
	{/if}
</div>
