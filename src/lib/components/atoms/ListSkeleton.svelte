<script lang="ts">
	/**
	 * ListSkeleton - shimmering placeholder rows used while a list panel's data
	 * is still absent (e.g. the gesture back-preview when the target tab's cache
	 * is cold, or the MobileTabPager during initial load).
	 */
	interface ListSkeletonProps {
		rows?: number;
		rowClass?: string;
		label: string;
	}

	let { rows = 6, rowClass = 'h-16', label }: ListSkeletonProps = $props();
</script>

<div class="space-y-1" role="status" aria-label={label}>
	{#each Array.from({ length: rows }, (_item, index) => index) as index (index)}
		<div class="skeleton w-full rounded {rowClass}"></div>
	{/each}
</div>
