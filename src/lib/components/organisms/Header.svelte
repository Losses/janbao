<script lang="ts">
	/**
	 * Header Organism - Global sticky header (the App Bar) rendered once in
	 * AppShell. Desktop: logo + navigation links (Activity / Messages / Search).
	 * Mobile: a single row with a morphing square button (left), the centered
	 * MobileTabBar (which replaces the logo), and a square search icon (right) -
	 * one row, no second "forehead". The whole bar hides on scroll-down (and
	 * returns on scroll-up) via the shared scroll-chrome store on every viewport.
	 *
	 * Deep-page mode: on routes with no tab highlight (`getCurrentIndex === -1`
	 * - bookmarks, search, profile, admin, ...) the row transforms, bound 1:1 to
	 * the swipe-back gesture via the mobile-pager store (same signal/discipline
	 * as the tab-pill clip). `morph` is 0 at rest on a deep page (full back arrow
	 * + title) and 1 in root mode (hamburger + tabs + search); a swipe-back drags
	 * it 0 -> 1 so the hamburger morphs into a back arrow, the tab bar + search
	 * slide up off-screen, and the page title slides up from below. When
	 * `deepMorph` is null (tab/thread routes, or before hydration) the URL
	 * derives the default so a deep link SSRs in deep mode without a flash.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Logo from '$lib/components/atoms/Logo.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import BurgerArrowIcon from '$lib/components/atoms/BurgerArrowIcon.svelte';
	import MobileTabBar from '$lib/components/organisms/MobileTabBar.svelte';
	import { isNavActive } from '$lib/utils/nav-active';
	import { getCurrentTabIndex } from '$lib/utils/mobile-tabs';
	import { resolveDeepHeaderTitle } from '$lib/utils/deep-header-config';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { getMobilePagerStore } from '$lib/stores/mobile-pager.svelte';
	import { getNavigationStore, backHandler } from '$lib/stores/navigation.svelte';
	import { hopForHref } from '$lib/utils/history-nav';
	import { mdiMagnify } from '@mdi/js';
	import type { VoidHandler } from '$lib/types/handlers';
	import type { TranslationDict } from '$lib/types/translation';

	interface HeaderProps {
		t: TranslationDict;
		onToggleDrawer: VoidHandler;
	}

	let { t, onToggleDrawer }: HeaderProps = $props();

	const scrollChrome = getScrollChromeStore();
	const pager = getMobilePagerStore();
	const navStore = getNavigationStore();
	const tNav = $derived(t.nav);
	const currentPath = $derived(page.url.pathname);
	const translateY = $derived(scrollChrome.translateY);
	const scrolling = $derived(scrollChrome.scrolling);

	// Deep-page mode applies only to routes the tab bar cannot highlight (-1).
	const deepMode = $derived(getCurrentTabIndex(currentPath) === -1);
	// deepMorph is published only while a deep-page swipe-back is in flight; the
	// URL-derived default otherwise keeps SSR + at-rest correct (deep -> 0 ->
	// back arrow, else 1 -> hamburger).
	const morph = $derived(pager.deepMorph ?? (deepMode ? 0 : 1));
	const dragging = $derived(pager.dragging);
	const iconProgress = $derived(1 - morph); // BurgerArrowIcon: 0 hamburger, 1 arrow
	const title = $derived(page.data.headerTitle ?? resolveDeepHeaderTitle(currentPath, t) ?? '');
	const slideT = $derived(dragging ? 'none' : 'transform 200ms ease-out');
	// The tab bar + search slide up off-screen as morph -> 0; the title slides up
	// from below (translateY morph*100%: in place at morph 0, one row below at 1).
	const tabsLayerStyle = $derived(
		`transform: translateY(${-(1 - morph) * 100}%); transition: ${slideT}; pointer-events: ${morph > 0.5 ? 'auto' : 'none'}`
	);
	const titleLayerStyle = $derived(
		`transform: translateY(${morph * 100}%); transition: ${slideT}; pointer-events: ${morph < 0.5 ? 'auto' : 'none'}`
	);
	const searchStyle = $derived(
		`transform: translateY(${-(1 - morph) * 100}%); transition: ${slideT}; pointer-events: ${morph > 0.5 ? 'auto' : 'none'}`
	);

	let headerEl: HTMLElement | null = $state(null);

	$effect(() => {
		if (!headerEl) return;

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
				scrollChrome.setHeaderHeight(height);
				document.documentElement.style.setProperty('--header-height', `${height}px`);
			}
		});

		observer.observe(headerEl);
		return () => observer.disconnect();
	});

	/** Replicates the GesturePageLayout swipe-back commit: let any registered
	 * back handler consume it first, else hop via the navigation API (history.back
	 * when the previous entry matches, else goto), falling back to the site root. */
	function onBack(): void {
		if (backHandler.dispatch()) return;
		const target = navStore.backTarget;
		if (navStore.activeStack.length > 1) {
			if (hopForHref(target) === 'back') {
				history.back();
			} else {
				void goto(target, { replaceState: true });
			}
		} else {
			void goto('/', { replaceState: true });
		}
	}

	function onLeftButton(): void {
		if (deepMode) {
			onBack();
		} else {
			onToggleDrawer();
		}
	}
</script>

<header
	bind:this={headerEl}
	class="sticky top-0 z-40 mx-auto w-full max-w-[960px] px-0 transition-transform duration-200 md:mt-6 md:px-6"
	class:scroll-chrome-scrolling={scrolling}
	style:transform="translateY({translateY}px)"
>
	<div class="bg-neutral text-neutral-content shadow-md md:shadow-none">
		<nav class="flex items-center px-2 py-2 md:items-end md:px-6 md:pt-3 md:pb-2.5">
			<!-- Mobile: morphing square button. Root mode -> hamburger (opens the left
			     drawer); deep-page mode -> back arrow (goes back, bound to the gesture). -->
			<button
				type="button"
				class="flex size-10 shrink-0 items-center justify-center text-neutral-content/80 hover:bg-neutral-content/10 hover:text-neutral-content md:hidden"
				onclick={onLeftButton}
				aria-label={deepMode ? tNav['back'] : tNav['menu']}
			>
				<BurgerArrowIcon progress={iconProgress} {dragging} />
			</button>

			<!-- Desktop: Logo + navigation links (hidden on mobile, where the
			     centered tab bar replaces the logo) -->
			<div class="hidden items-end gap-6 md:flex">
				<Logo {t} class="text-neutral-content" />
				<div class="flex items-end gap-4">
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

			<!-- Mobile: stacked layers in the centre. The tab bar sits on top and
			     slides up off-screen in deep mode; the page title slides up from
			     below to replace it. Both fill the row height (h-10) so the bar
			     stays a single constant-height row. -->
			<div class="relative h-10 flex-1 md:hidden">
				<div class="absolute inset-0 flex items-center justify-center" style={tabsLayerStyle}>
					<MobileTabBar {t} />
				</div>
				<div class="absolute inset-0 flex items-center justify-center px-2" style={titleLayerStyle}>
					<span class="w-full truncate text-center font-medium text-neutral-content">{title}</span>
				</div>
			</div>

			<!-- Mobile: square search icon. Slides up off-screen with the tab bar in
			     deep mode, leaving the right side empty. -->
			<a
				href="/search"
				class="flex size-10 shrink-0 items-center justify-center text-neutral-content/80 hover:bg-neutral-content/10 hover:text-neutral-content md:hidden"
				style={searchStyle}
				aria-label={tNav['search']}
				aria-current={isNavActive(currentPath, '/search') ? 'page' : undefined}
			>
				<Icon path={mdiMagnify} size={22} />
			</a>
		</nav>
	</div>
</header>
