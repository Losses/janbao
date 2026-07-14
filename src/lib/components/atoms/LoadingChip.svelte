<script lang="ts">
	import { mdiArrowLeft } from '@mdi/js';
	import Icon from '$lib/components/atoms/Icon.svelte';

	/**
	 * LoadingChip - the loading pill used by any list panel's !data fallback.
	 * Shows the loading page's icon + label, scaled and pulsing. Extracted so
	 * every loading surface is this one indicator instead of drifting to a
	 * spinner or skeleton.
	 *
	 * Panels render it with the defaults (expanded, pulsing, scale 1.15) for a
	 * static "this page is loading" state.
	 */
	interface LoadingChipProps {
		/** mdi icon path for the page that is loading. */
		icon?: string;
		/** Resolved label for that page. */
		label?: string;
		/** Full pill with text (true) vs collapsed 36px circle (false). */
		expanded?: boolean;
		/** Pulse while a navigation is pending. */
		pulsing?: boolean;
		opacity?: number;
	}

	let {
		icon = mdiArrowLeft,
		label,
		expanded = true,
		pulsing = true,
		opacity = 1
	}: LoadingChipProps = $props();
</script>

<div
	class="loading-chip bg-neutral text-neutral-content rounded-full flex items-center justify-center shadow-lg font-medium whitespace-nowrap overflow-hidden"
	class:gap-2={expanded}
	class:animate-pulse={pulsing}
	style="transform: scale(1.15); opacity: {opacity}; height: 36px;{expanded
		? ' padding: 6px 12px;'
		: ' padding: 0; min-width: 36px; width: 36px;'}"
>
	{#if icon}
		<Icon path={icon} size={18} class="shrink-0 text-neutral-content" />
	{/if}
	<span class="loading-chip-text overflow-hidden text-sm whitespace-nowrap text-neutral-content">
		{label ?? ''}
	</span>
</div>

<style>
	.loading-chip {
		font-family: var(--font-sans);
	}
	.loading-chip-text {
		display: inline-block;
	}
</style>
