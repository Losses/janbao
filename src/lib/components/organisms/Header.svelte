<script lang="ts">
	/**
	 * Header Organism - Global sticky header rendered inside DualColumnLayout.
	 * Contains the logo, desktop navigation links (Activity / Messages / Search),
	 * and on mobile a square hamburger (left, opens the left drawer) plus a square
	 * search icon (right). On mobile the header hides on scroll-down (and returns
	 * on scroll-up) via the shared scroll-chrome store; desktop is in-flow and
	 * unaffected.
	 */
	import { page } from '$app/state';
	import Logo from '$lib/components/atoms/Logo.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { isNavActive } from '$lib/utils/nav-active';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { mdiMenu, mdiMagnify } from '@mdi/js';
	import type { VoidHandler } from '$lib/types/handlers';
	import type { TranslationDict } from '$lib/types/translation';

	interface HeaderProps {
		t: TranslationDict;
		onToggleDrawer: VoidHandler;
	}

	let { t, onToggleDrawer }: HeaderProps = $props();

	const scrollChrome = getScrollChromeStore();
	const tNav = $derived(t.nav);
	const currentPath = $derived(page.url.pathname);
	const hidden = $derived(scrollChrome.hidden);
</script>

<header
	class="sticky top-0 z-40 mx-auto w-full max-w-[960px] px-0 transition-transform duration-200 md:relative md:mt-6 md:px-6 {hidden
		? '-translate-y-full'
		: ''}"
>
	<nav
		class="flex items-center justify-between bg-neutral px-2 py-2 text-neutral-content shadow-sm md:items-end md:px-6 md:pt-3 md:pb-2.5"
	>
		<div class="flex items-center gap-2 md:items-end md:gap-6">
			<!-- Mobile: square hamburger button (opens the left drawer) -->
			<button
				type="button"
				class="flex size-10 items-center justify-center text-neutral-content/80 hover:bg-neutral-content/10 hover:text-neutral-content md:hidden"
				onclick={onToggleDrawer}
				aria-label={tNav['menu']}
			>
				<Icon path={mdiMenu} size={24} />
			</button>

			<!-- Left: Logo component -->
			<Logo {t} class="text-neutral-content" />

			<!-- Desktop Navigation (hidden on mobile) -->
			<div class="hidden items-end gap-4 md:flex">
				<a
					href="/activity"
					class="text-sm font-medium text-neutral-content/70 hover:text-neutral-content hover:underline"
					class:text-accent={isNavActive(currentPath, '/activity')}
					aria-current={isNavActive(currentPath, '/activity') ? 'page' : undefined}
				>
					{tNav['activity']}
				</a>
				<a
					href="/messages/inbox"
					class="text-sm font-medium text-neutral-content/70 hover:text-neutral-content hover:underline"
					class:text-accent={isNavActive(currentPath, '/messages')}
					aria-current={isNavActive(currentPath, '/messages') ? 'page' : undefined}
				>
					{tNav['messages']}
				</a>
				<a
					href="/search"
					class="text-sm font-medium text-neutral-content/70 hover:text-neutral-content hover:underline"
					class:text-accent={isNavActive(currentPath, '/search')}
					aria-current={isNavActive(currentPath, '/search') ? 'page' : undefined}
				>
					{tNav['search']}
				</a>
			</div>
		</div>

		<!-- Right: Mobile square search icon (desktop keeps its text nav links) -->
		<a
			href="/search"
			class="flex size-10 items-center justify-center text-neutral-content/80 hover:bg-neutral-content/10 hover:text-neutral-content md:hidden"
			aria-label={tNav['search']}
			aria-current={isNavActive(currentPath, '/search') ? 'page' : undefined}
		>
			<Icon path={mdiMagnify} size={22} />
		</a>
	</nav>
</header>
