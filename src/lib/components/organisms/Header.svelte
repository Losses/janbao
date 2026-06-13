<script lang="ts">
	/**
	 * Header Organism - Global sticky header rendered inside DualColumnLayout.
	 * Contains site name text, desktop navigation, sign-in/register links for guests,
	 * and a mobile hamburger button that opens the sidebar drawer.
	 */
	import { page } from '$app/state';
	import Logo from '$lib/components/atoms/Logo.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { mdiMenu } from '@mdi/js';
	import type { VoidHandler } from '$lib/types/handlers';
	import type { TranslationDict } from '$lib/types/translation';

	interface HeaderProps {
		t: TranslationDict;
		onToggleDrawer: VoidHandler;
	}

	let { t, onToggleDrawer }: HeaderProps = $props();

	const tNav = $derived(t.nav);
	const currentPath = $derived(page.url.pathname);

	function isNavActive(href: string): boolean {
		if (href === '/') return currentPath === '/';
		return currentPath.startsWith(href);
	}
</script>

<header
	class="sticky md:relative top-0 z-40 mx-auto w-full max-w-[960px] px-0 md:px-6 mt-0 md:mt-6"
>
	<nav
		class="bg-neutral text-neutral-content flex items-end justify-between px-4 md:px-6 pt-3 pb-2.5 shadow-sm"
	>
		<div class="flex items-end gap-6">
			<!-- Left: Logo component -->
			<Logo class="text-neutral-content" />

			<!-- Desktop Navigation (hidden on mobile) -->
			<div class="hidden md:flex items-end gap-4">
				<a
					href="/"
					class="text-sm font-medium text-neutral-content/70 hover:text-neutral-content hover:underline"
					class:text-accent={isNavActive('/')}
					aria-current={isNavActive('/') ? 'page' : undefined}
				>
					{tNav['home']}
				</a>
				<a
					href="/activity"
					class="text-sm font-medium text-neutral-content/70 hover:text-neutral-content hover:underline"
					class:text-accent={isNavActive('/activity')}
					aria-current={isNavActive('/activity') ? 'page' : undefined}
				>
					{tNav['activity']}
				</a>
				<a
					href="/messages/inbox"
					class="text-sm font-medium text-neutral-content/70 hover:text-neutral-content hover:underline"
					class:text-accent={isNavActive('/messages')}
					aria-current={isNavActive('/messages') ? 'page' : undefined}
				>
					{tNav['messages']}
				</a>
			</div>
		</div>

		<!-- Right: Mobile menu button (hidden on desktop) -->
		<div class="flex items-center gap-2 self-center">
			<!-- Mobile: Hamburger menu button -->
			<button
				class="btn btn-ghost btn-sm md:hidden text-neutral-content/70 hover:text-neutral-content"
				onclick={onToggleDrawer}
				aria-label={tNav['menu']}
			>
				<Icon path={mdiMenu} size={24} />
			</button>
		</div>
	</nav>
</header>
