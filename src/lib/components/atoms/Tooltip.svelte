<script lang="ts">
	/**
	 * Tooltip Atom - Click-triggered absolute-positioned overlay wrapper.
	 * Children are rendered directly as the trigger element (no wrapping button).
	 * Expects children to be an interactive element (button, link, etc.).
	 */
	import type { VoidHandler } from '$lib/types/handlers';

	interface TooltipProps {
		isOpen?: boolean;
		onToggle: VoidHandler;
		onClose: VoidHandler;
		class?: string;
		children: import('svelte').Snippet;
		popover: import('svelte').Snippet;
	}

	let {
		isOpen = false,
		onToggle,
		onClose,
		class: className = '',
		children,
		popover
	}: TooltipProps = $props();

	let containerRef: HTMLDivElement | undefined = $state();
</script>

<svelte:window
	onclick={(e) => {
		if (isOpen && containerRef && !containerRef.contains(e.target as Node)) {
			onClose();
		}
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape' && isOpen) {
			onClose();
		}
	}}
/>

<div class="relative inline-flex {className}" bind:this={containerRef}>
	<!-- Trigger wrapper (clicks bubble up to toggle tooltip) -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="inline-flex cursor-pointer"
		onclick={() => {
			onToggle();
		}}
	>
		{@render children()}
	</div>

	<!-- Popover content -->
	{#if isOpen}
		<div
			class="absolute left-1/2 -translate-x-1/2 top-full z-50 mt-2 w-72 max-w-[calc(100vw-1rem)] rounded-box border border-base-300 bg-base-100 shadow-lg"
			role="dialog"
			tabindex="-1"
			onkeydown={(e) => {
				if (e.key === 'Escape') onClose();
			}}
		>
			{@render popover()}
		</div>
	{/if}
</div>
