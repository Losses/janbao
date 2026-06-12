<script lang="ts">
	/**
	 * Tooltip Atom — Click-triggered absolute-positioned overlay wrapper.
	 * Renders children as the trigger and exposes a popover via snippet.
	 */
	interface TooltipProps {
		isOpen?: boolean;
		onToggle: () => void;
		onClose: () => void;
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
/>

<div class="relative {className}" bind:this={containerRef}>
	<!-- Trigger element -->
	<button
		type="button"
		class="inline-flex items-center"
		onclick={(e) => {
			e.stopPropagation();
			onToggle();
		}}
		aria-expanded={isOpen}
	>
		{@render children()}
	</button>

	<!-- Popover content -->
	{#if isOpen}
		<div
			class="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-base-300 bg-base-100 shadow-lg"
			role="dialog"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => {
				if (e.key === 'Escape') onClose();
			}}
		>
			{@render popover()}
		</div>
	{/if}
</div>
