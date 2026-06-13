<script lang="ts">
	/**
	 * Header Organism - Global sticky header rendered inside DualColumnLayout.
	 * Contains site name text, desktop navigation, sign-in/register links for guests,
	 * and a mobile hamburger button that opens the sidebar drawer.
	 */
	import { page } from '$app/state';
	import { getSiteName } from '$lib/utils/title';
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

<header class="sticky top-0 z-40 backdrop-blur bg-base-100/80 border-b border-base-200">
	<nav class="mx-auto max-w-[960px] px-4 md:px-6 h-14 flex items-center justify-between">
		<!-- Left: Site name (plain text, no icon) -->
		<a href="/" class="text-lg font-bold text-base-content">{getSiteName()}</a>

		<!-- Center: Desktop Navigation (hidden on mobile) -->
		<div class="hidden md:flex items-center gap-1">
			<a
				href="/"
				class="btn btn-ghost btn-sm text-sm"
				class:text-primary={isNavActive('/')}
				aria-current={isNavActive('/') ? 'page' : undefined}
			>
				{tNav['home']}
			</a>
			<a
				href="/categories"
				class="btn btn-ghost btn-sm text-sm"
				class:text-primary={isNavActive('/categories')}
				aria-current={isNavActive('/categories') ? 'page' : undefined}
			>
				{tNav['categories']}
			</a>
			<a
				href="/activity"
				class="btn btn-ghost btn-sm text-sm"
				class:text-primary={isNavActive('/activity')}
				aria-current={isNavActive('/activity') ? 'page' : undefined}
			>
				{tNav['activity']}
			</a>
			<a
				href="/messages/inbox"
				class="btn btn-ghost btn-sm text-sm"
				class:text-primary={isNavActive('/messages')}
				aria-current={isNavActive('/messages') ? 'page' : undefined}
			>
				{tNav['messages']}
			</a>
		</div>

		<!-- Right: Mobile menu button (hidden on desktop) -->
		<div class="flex items-center gap-2">
			<!-- Mobile: Hamburger menu button -->
			<button
				class="btn btn-ghost btn-sm md:hidden"
				onclick={onToggleDrawer}
				aria-label={tNav['menu']}
			>
				<Icon path={mdiMenu} size={24} />
			</button>
		</div>
	</nav>
</header>
