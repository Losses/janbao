<script lang="ts">
	/**
	 * Tooltip Atom — Click-triggered absolute-positioned overlay wrapper.
	 * Children are rendered directly as the trigger element (no wrapping button).
	 * Expects children to be an interactive element (button, link, etc.).
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
	onkeydown={(e) => {
		if (e.key === 'Escape' && isOpen) {
			onClose();
		}
	}}
/>

<div class="relative inline-flex {className}" bind:this={containerRef}>
	<!-- Trigger wrapper — uses role="button" for a11y since children may be interactive elements -->
	<div
		class="inline-flex cursor-pointer"
		role="button"
		tabindex="0"
		onclick={(e) => {
			e.stopPropagation();
			onToggle();
		}}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.stopPropagation();
				e.preventDefault();
				onToggle();
			}
		}}
	>
		{@render children()}
	</div>

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
