<script lang="ts">
	import Skeleton from '$lib/components/atoms/Skeleton.svelte';

	/**
	 * ActivitySkeleton - a loading placeholder shaped like ActivityPanel
	 * (composer + title banner + activity rows + bottom paginator). Each
	 * row mirrors an ActivityRow's blocks (avatar + name line + content
	 * lines). Composes `Skeleton` boxes so the look stays consistent.
	 */
	const rows = [0, 1, 2, 3, 4, 5];
</script>

<div class="space-y-3">
	<!-- Composer (editor area + submit button) -->
	<div class="space-y-3">
		<Skeleton class="h-24 w-full rounded" />
		<div class="mt-3 flex justify-end">
			<Skeleton class="h-7 w-20 rounded" />
		</div>
	</div>

	<!-- Title banner: page title + paginator -->
	<div class="flex items-center justify-between border-b border-base-300 pb-4">
		<Skeleton class="h-5 w-24" />
		<Skeleton class="h-5 w-32" />
	</div>

	<!-- Activity rows: avatar + name + content lines -->
	<div class="space-y-0 divide-y divide-base-200">
		{#each rows as r (r)}
			<div class="flex gap-3 py-3">
				<Skeleton class="h-10 w-10 shrink-0 rounded-full" />
				<div class="flex-1 space-y-2 pt-1">
					<Skeleton class="h-4 w-1/3" />
					<Skeleton class="h-3 w-full" />
					<Skeleton class="h-3 w-4/5" />
				</div>
			</div>
		{/each}
	</div>

	<!-- Bottom paginator -->
	<div class="flex justify-end pt-2">
		<Skeleton class="h-5 w-32" />
	</div>
</div>
