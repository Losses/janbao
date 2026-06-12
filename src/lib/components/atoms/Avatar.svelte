<script lang="ts">
	/**
	 * Avatar Atom — Renders a circular user avatar image or a text-based fallback (first letter of displayName).
	 * Supports sizes: xs (24px), sm (32px), md (40px), lg (56px).
	 */
	interface AvatarProps {
		src?: string | null;
		displayName?: string | null;
		size?: 'xs' | 'sm' | 'md' | 'lg';
		class?: string;
	}

	let {
		src = null,
		displayName = null,
		size = 'md',
		class: className = ''
	}: AvatarProps = $props();

	const sizeMap: Record<string, string> = {
		xs: 'avatar-xs', // 24px via DaisyUI
		sm: 'avatar-sm', // 32px via DaisyUI
		md: '', // default ~40px
		lg: 'avatar-lg' // 56px via DaisyUI
	};

	const sizeClass = $derived(sizeMap[size] ?? '');

	const fallbackLetter = $derived(displayName?.[0]?.toUpperCase() ?? '?');
</script>

<div class="avatar {sizeClass} {className}">
	<div class="w-full rounded-full bg-neutral text-neutral-content">
		{#if src}
			<img {src} alt={displayName ?? 'User avatar'} loading="lazy" />
		{:else}
			<span class="flex items-center justify-center text-sm font-medium">{fallbackLetter}</span>
		{/if}
	</div>
</div>
