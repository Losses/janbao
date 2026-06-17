<script lang="ts">
	/**
	 * EmptyState Molecule - The single, shared "nothing here" block.
	 * Replaces the dozen+ hand-rolled empty-state divs scattered across routes,
	 * which varied between bordered cards, borderless cards, and bare text rows.
	 *
	 * `bordered` picks the container style: a card with a border for page-level
	 * empty states (default), or a borderless block for states nested inside an
	 * already-bordered list/container where a second border would double up.
	 */
	import type { Snippet } from 'svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';

	interface EmptyStateProps {
		message: string;
		bordered?: boolean;
		icon?: string;
		children?: Snippet;
	}

	let { message, bordered = true, icon, children }: EmptyStateProps = $props();
</script>

{#if bordered}
	<div class="card bg-base-200/40 border border-base-300 p-10 text-center text-base-content/50">
		{#if icon}
			<Icon path={icon} size={32} class="mx-auto mb-2 opacity-70" />
		{/if}
		<p>{message}</p>
		{#if children}
			<div class="mt-3">{@render children()}</div>
		{/if}
	</div>
{:else}
	<div class="p-10 text-center text-base-content/50">
		{#if icon}
			<Icon path={icon} size={32} class="mx-auto mb-2 opacity-70" />
		{/if}
		<p>{message}</p>
		{#if children}
			<div class="mt-3">{@render children()}</div>
		{/if}
	</div>
{/if}
