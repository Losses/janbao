<script lang="ts">
	/**
	 * Header Organism - Global sticky header rendered inside DualColumnLayout.
	 * Contains logo, desktop navigation, user info or auth links,
	 * and a mobile hamburger button that opens the sidebar drawer.
	 */
	import Logo from '$lib/components/atoms/Logo.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import Avatar from '$lib/components/atoms/Avatar.svelte';
	import { mdiMenu } from '@mdi/js';
	import type { VoidHandler } from '$lib/types/handlers';
	import type { UserInfoSummary } from '$lib/types/api';

	interface HeaderProps {
		user: UserInfoSummary | null;
		t: Record<string, Record<string, string> | string>;
		onToggleDrawer: VoidHandler;
	}

	let { user, t, onToggleDrawer }: HeaderProps = $props();

	const tNav = $derived((t as Record<string, Record<string, string>>).nav ?? {});
</script>

<header class="sticky top-0 z-40 backdrop-blur bg-base-100/80 border-b border-base-200">
	<nav class="mx-auto max-w-[960px] px-4 md:px-6 h-14 flex items-center justify-between">
		<!-- Left: Logo -->
		<Logo />

		<!-- Center: Desktop Navigation (hidden on mobile) -->
		<div class="hidden md:flex items-center gap-1">
			<a href="/" class="btn btn-ghost btn-sm text-sm">{tNav['home']}</a>
			<a href="/categories" class="btn btn-ghost btn-sm text-sm">
				{tNav['categories']}
			</a>
			<a href="/activity" class="btn btn-ghost btn-sm text-sm">
				{tNav['activity']}
			</a>
			<a href="/messages/inbox" class="btn btn-ghost btn-sm text-sm">
				{tNav['messages']}
			</a>
		</div>

		<!-- Right: User info or auth links + Mobile menu button -->
		<div class="flex items-center gap-2">
			{#if user}
				<div class="hidden md:flex items-center gap-2">
					<Avatar
						src={user.avatarFileId ? `/img/${user.avatarFileId}` : null}
						displayName={user.displayName}
						size="xs"
					/>
					<a
						href="/profile/{user.id}/{user.username}"
						class="text-sm font-medium text-base-content hover:text-primary transition-colors"
					>
						{user.displayName}
					</a>
				</div>
			{:else}
				<div class="hidden md:flex items-center gap-2">
					<a href="/entry/signin" class="btn btn-ghost btn-sm text-sm">
						{tNav['signin']}
					</a>
					<a href="/entry/register" class="btn btn-primary btn-sm text-sm">
						{tNav['register']}
					</a>
				</div>
			{/if}

			<!-- Mobile: Hamburger menu button -->
			<button
				class="btn btn-ghost btn-sm md:hidden"
				onclick={onToggleDrawer}
				aria-label="Open menu"
			>
				<Icon path={mdiMenu} size={24} />
			</button>
		</div>
	</nav>
</header>
