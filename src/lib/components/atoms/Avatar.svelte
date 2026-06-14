<script lang="ts">
	/**
	 * Avatar Atom - Renders a circular user avatar image or a text-based fallback (first letter of displayName).
	 * Supports sizes: xs (24px), sm (32px), md (40px), lg (56px).
	 *
	 * The avatar URL is derived here (not at every call site): when `avatarFileId`
	 * is truthy the user has an uploaded avatar, served from `/avatar/<userId>`.
	 * Pass `userId` + `avatarFileId`; omit both for a placeholder (letter fallback).
	 */
	interface AvatarProps {
		userId?: number | null;
		avatarFileId?: string | null;
		displayName?: string | null;
		size?: 'xs' | 'sm' | 'md' | 'lg';
		class?: string;
	}

	let {
		userId = null,
		avatarFileId = null,
		displayName = null,
		size = 'md',
		class: className = ''
	}: AvatarProps = $props();

	const sizeMap: Record<string, string> = {
		xs: 'w-6 h-6 text-xs',
		sm: 'w-8 h-8 text-sm',
		md: 'w-10 h-10 text-base',
		lg: 'w-14 h-14 text-xl'
	};

	const sizeClass = $derived(sizeMap[size] ?? 'w-10 h-10 text-base');
	const fallbackLetter = $derived(displayName?.[0]?.toUpperCase() ?? '?');
	const src = $derived(avatarFileId && userId != null ? `/avatar/${userId}` : null);
</script>

<div class="avatar {className}">
	<div
		class="{sizeClass} rounded-full bg-neutral text-neutral-content flex items-center justify-center"
	>
		{#if src}
			<img {src} alt={displayName ?? 'User avatar'} loading="lazy" />
		{:else}
			<span class="font-medium">{fallbackLetter}</span>
		{/if}
	</div>
</div>
