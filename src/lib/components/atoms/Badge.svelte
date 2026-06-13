<script lang="ts">
	/**
	 * Badge Atom - Status label for unread counts, pin states, etc.
	 * Supports variants: primary, neutral, warning, accent and sizes xs/sm/md.
	 */
	interface BadgeProps {
		variant?: 'primary' | 'neutral' | 'warning' | 'accent';
		size?: 'xs' | 'sm' | 'md';
		class?: string;
		children?: import('svelte').Snippet;
	}

	let { variant = 'neutral', size = 'sm', class: className = '', children }: BadgeProps = $props();

	const variantClasses: Record<string, string> = {
		primary: 'badge-primary',
		neutral: 'badge-ghost',
		warning: 'badge-warning',
		accent: 'badge-accent'
	};

	const sizeClasses: Record<string, string> = {
		xs: 'badge-xs',
		sm: 'badge-sm',
		md: 'badge-md'
	};

	const badgeClass = $derived(variantClasses[variant] ?? 'badge-ghost');
	const sizeClass = $derived(sizeClasses[size] ?? 'badge-sm');
</script>

<span class="badge {sizeClass} {badgeClass} {className}">
	{#if children}
		{@render children()}
	{/if}
</span>
