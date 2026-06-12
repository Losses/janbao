<script lang="ts">
	/**
	 * LinkButton Atom — A unified minimalist link styled to look like text but functioning as an interactive button.
	 * Used in footer metadata blocks, inline comments, and lists.
	 */
	import type { MouseEventHandler } from '$lib/types/handlers';

	interface LinkButtonProps {
		onclick?: MouseEventHandler;
		href?: string;
		disabled?: boolean;
		class?: string;
		children?: import('svelte').Snippet;
	}

	let {
		onclick,
		href,
		disabled = false,
		class: className = '',
		children
	}: LinkButtonProps = $props();

	const baseClass =
		'font-normal text-primary/80 transition-colors duration-150 hover:font-bold hover:text-primary disabled:opacity-40 disabled:hover:font-normal';
</script>

{#if href && !disabled}
	<a {href} class="{baseClass} {className}" {onclick}>
		{#if children}
			{@render children()}
		{/if}
	</a>
{:else}
	<button type="button" class="{baseClass} {className}" {onclick} {disabled}>
		{#if children}
			{@render children()}
		{/if}
	</button>
{/if}
