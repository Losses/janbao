<script lang="ts">
	/**
	 * Badge Atom — Status label for unread counts, pin states, etc.
	 * Supports variants: primary, neutral, warning, accent.
	 */
	interface BadgeProps {
		variant?: 'primary' | 'neutral' | 'warning' | 'accent';
		class?: string;
		children?: import('svelte').Snippet;
	}

	let { variant = 'neutral', class: className = '', children }: BadgeProps = $props();

	const variantClasses: Record<string, string> = {
		primary: 'badge-primary',
		neutral: 'badge-ghost',
		warning: 'badge-warning',
		accent: 'badge-accent'
	};

	const badgeClass = $derived(variantClasses[variant] ?? 'badge-ghost');
</script>

<span class="badge badge-sm {badgeClass} {className}">
	{#if children}
		{@render children()}
	{/if}
</span>
