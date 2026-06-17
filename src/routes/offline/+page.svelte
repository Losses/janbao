<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.t.offline.reader.listTitle} · Janbao</title>
</svelte:head>

<div class="space-y-3">
	<h1 class="text-xl font-semibold">{data.t.offline.reader.listTitle}</h1>
	<p class="text-sm opacity-70">{data.t.offline.reader.listHint}</p>

	{#if data.discussions.length === 0}
		<p class="text-sm opacity-70">{data.t.offline.reader.empty}</p>
	{:else}
		<ul class="divide-y divide-base-300">
			{#each data.discussions as d (d.id)}
				<li class="py-2">
					<a class="link link-hover" href={`/offline/${d.id}`}>{d.title}</a>
					<span class="ml-2 text-xs opacity-60"
						>{d.commentCount} {data.t.offline.reader.replies}</span
					>
				</li>
			{/each}
		</ul>
	{/if}
</div>
