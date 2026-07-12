<script lang="ts">
	import Skeleton from '$lib/components/atoms/Skeleton.svelte';

	/**
	 * MessagesSkeleton: a loading placeholder shaped like MessagesPanel
	 * (a list of conversation cards). Each card mirrors a conversation
	 * row's blocks (avatar + name line + preview line). Composes `Skeleton`
	 * boxes so the placeholder color and animation stay consistent with the
	 * shared atom. Used as the defensive fallback in NavPipelineHost's
	 * `/messages/inbox` preview branch (unreachable while the inbox is
	 * eager-loaded by the root layout; present for a future non-eager target).
	 */
	const rows = [0, 1, 2, 3, 4, 5];
</script>

<div class="space-y-0 divide-y divide-base-200">
	{#each rows as r (r)}
		<div class="flex gap-3 p-3">
			<Skeleton class="h-10 w-10 shrink-0 rounded-full" />
			<div class="flex flex-1 flex-col gap-2 pt-1">
				<Skeleton class="h-4 w-1/3" />
				<Skeleton class="h-3 w-full" />
				<Skeleton class="h-3 w-4/5" />
			</div>
		</div>
	{/each}
</div>
