<script lang="ts">
	import Skeleton from '$lib/components/atoms/Skeleton.svelte';

	/**
	 * DiscussionsSkeleton - a loading placeholder shaped like DiscussionsPanel
	 * (top paginator + a bordered, divided list of discussion rows + bottom
	 * paginator). Each row mirrors a DiscussionRow's blocks (title line +
	 * meta line). Composes `Skeleton` boxes so the look stays consistent.
	 */
	const rows = [0, 1, 2, 3, 4, 5, 6];
</script>

<div class="space-y-3">
	<!-- Top paginator -->
	<div class="flex justify-end">
		<Skeleton class="h-5 w-32" />
	</div>

	<!-- Discussion rows: title + meta, in the bordered/divided list card -->
	<div class="overflow-hidden border-y border-base-300 bg-base-100">
		<div class="divide-y divide-base-300">
			{#each rows as r (r)}
				<div class="space-y-2 px-3 py-3">
					<Skeleton class="h-4 w-3/4" />
					<Skeleton class="h-3 w-1/2" />
				</div>
			{/each}
		</div>
	</div>

	<!-- Bottom paginator -->
	<div class="flex justify-end pt-2">
		<Skeleton class="h-5 w-32" />
	</div>
</div>
