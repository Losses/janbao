<script lang="ts">
	/**
	 * Reusable inline alert message component.
	 * Self-conditional rendering — renders nothing when message is empty.
	 */
	let { message = '', class: className = '' }: { message?: string; class?: string } = $props();
</script>

{#if message}
	<div class="alert alert-warning text-sm rounded-lg py-2 {className}" role="alert">
		<span>{message}</span>
	</div>
{/if}
