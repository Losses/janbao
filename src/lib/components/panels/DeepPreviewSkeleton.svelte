<script lang="ts">
	import Skeleton from '$lib/components/atoms/Skeleton.svelte';

	/**
	 * DeepPreviewSkeleton - a generic loading placeholder for a deep-page
	 * back-target whose preview panel is not registered in
	 * `PREVIEW_PANEL_CONFIG` (for example `/bookmarks`, `/notifications`,
	 * `/search`, `/messages/<id>`). Rendered in the NavPipelineHost left
	 * panel during a back-swipe so the slide reveals a shaped placeholder
	 * instead of empty space; the real route mounts on commit. A header
	 * bar plus a divided row stack that reads as a generic content page.
	 */
	const rows = [0, 1, 2, 3, 4];
</script>

<div class="space-y-3 p-3">
	<div class="flex items-center justify-between">
		<Skeleton class="h-6 w-40" />
		<Skeleton class="h-6 w-20" />
	</div>
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
</div>
