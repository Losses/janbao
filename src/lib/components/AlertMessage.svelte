<script lang="ts">
	/**
	 * Reusable inline alert message component.
	 * Self-conditional rendering - renders nothing when message is empty.
	 */
	interface AlertMessageProps {
		message?: string;
		class?: string;
	}

	let { message = '', class: className = '' }: AlertMessageProps = $props();
</script>

{#if message}
	<div class="alert alert-warning text-sm rounded-box py-2 {className}" role="alert">
		<span>{message}</span>
	</div>
{/if}
