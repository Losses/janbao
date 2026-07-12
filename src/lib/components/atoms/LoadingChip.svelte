<script lang="ts">
	import { mdiArrowLeft } from '@mdi/js';
	import Icon from '$lib/components/atoms/Icon.svelte';

	/**
	 * LoadingChip - the card-scaling loading pill used by any list panel's !data
	 * fallback. Shows the loading page's icon + label, scaled and pulsing.
	 * Extracted so every loading surface is this one indicator instead of
	 * drifting to a spinner or skeleton.
	 *
	 * Panels use the defaults (expanded, pulsing, scale 1.15) for a static "this
	 * page is loading" state.
	 */
	interface LoadingChipProps {
		/** mdi icon path for the page that is loading / being swiped toward. */
		icon?: string;
		/** Resolved label for that page. */
		label?: string;
		/** transform scale; gesture drives this from drag progress. */
		scale?: number;
		/** Full pill with text (true) vs collapsed 36px circle (false). */
		expanded?: boolean;
		/** Pulse while a navigation is pending. */
		pulsing?: boolean;
		/** Drag in progress: drops the max-width transition for 1:1 finger follow. */
		dragging?: boolean;
		opacity?: number;
		/** px cap for the pill width (gesture expands it with the drag). */
		maxWidth?: number;
		/** px cap for the label text (gesture reveals it with the drag). */
		textMaxWidth?: number;
	}

	let {
		icon = mdiArrowLeft,
		label,
		scale = 1.15,
		expanded = true,
		pulsing = true,
		dragging = false,
		opacity = 1,
		maxWidth,
		textMaxWidth
	}: LoadingChipProps = $props();
</script>

<div
	class="loading-chip bg-neutral text-neutral-content rounded-full flex items-center justify-center shadow-lg font-medium whitespace-nowrap overflow-hidden"
	class:gap-2={expanded}
	class:dragging
	class:animate-pulse={pulsing}
	style="transform: scale({scale}); opacity: {opacity}; height: 36px;{expanded
		? ' padding: 6px 12px;'
		: ' padding: 0; min-width: 36px; width: 36px;'}{maxWidth !== undefined
		? ` max-width: ${maxWidth}px;`
		: ''}"
>
	{#if icon}
		<Icon path={icon} size={18} class="shrink-0 text-neutral-content" />
	{/if}
	<span
		class="loading-chip-text overflow-hidden text-sm whitespace-nowrap text-neutral-content"
		style={textMaxWidth !== undefined ? `max-width: ${textMaxWidth}px;` : ''}
	>
		{label ?? ''}
	</span>
</div>

<style>
	.loading-chip {
		font-family: var(--font-sans);
		transition:
			transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1),
			opacity 200ms ease,
			max-width 200ms ease;
	}
	.loading-chip.dragging {
		transition:
			max-width 0s linear,
			transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.loading-chip-text {
		display: inline-block;
		transition: max-width 200ms ease;
	}
	.loading-chip.dragging .loading-chip-text {
		transition: none !important;
	}
</style>
