<script lang="ts">
	/**
	 * ForwardEdgeOverlay - the right-edge reveal shown while the user drags the
	 * forward edge of the last tab toward its declared deep neighbour (Messages
	 * -> /search). Grows from the right edge with the drag (width = the reveal
	 * px); sits below the FAB (z-30 < z-35) and the Header; carries a generic
	 * forward-arrow affordance, not a search affordance; `pointer-events: none`
	 * so it never steals the drag. Reads the `forwardEdge` store's `reveal`
	 * reactively (the store is the single writer; this component is a reader).
	 */
	import { getForwardEdgeStore } from '$lib/stores/forward-edge.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { mdiArrowRight } from '@mdi/js';

	const forwardEdge = getForwardEdgeStore();
	const reveal = $derived(forwardEdge.reveal);
</script>

{#if reveal !== null}
	<div
		class="forward-edge-overlay pointer-events-none absolute inset-y-0 right-0 z-30 flex items-center justify-end pr-10"
		style="width: {reveal}px;"
		aria-hidden="true"
	>
		<Icon path={mdiArrowRight} size={20} />
	</div>
{/if}

<style>
	/* Mirrors the back-chip overlay's base-200 fill (MobileTabPager.svelte). */
	.forward-edge-overlay {
		background-color: var(--color-base-200);
	}
</style>
