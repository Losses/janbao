<script lang="ts">
	/**
	 * Header Organism - the global sticky App Bar (rendered once in AppShell).
	 *
	 * Desktop: logo + navigation links (Activity / Messages / Search).
	 *
	 * Mobile: three modes, resolved from the URL by `resolveHeaderMode`:
	 *   - 'root'   the tab bar (MobileTabBar) + hamburger (drawer) + search icon.
	 *   - 'deep'   back-arrow + title (the existing morph, driven by `backMorph`).
	 *   - 'search' a magnifier (decorative, non-functional) + query input + filter
	 *              button + the SearchTabBar scope strip. Exit from /search is the
	 *              leftmost-scope left-swipe (GesturePageLayout back-swipe), so the
	 *              search-mode left slot has no back/drawer action.
	 *
	 * The centre region stacks the root/deep/search layers absolutely and
	 * cross-fades them by `morph` (`backMorph ?? (mode==='root'?1:0)`), the same
	 * `translateY` discipline the deep-page morph uses; the search layer slides
	 * down out as a back-swipe commits toward the source tab.
	 */
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import Logo from '$lib/components/atoms/Logo.svelte';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import BurgerArrowIcon from '$lib/components/atoms/BurgerArrowIcon.svelte';
	import MobileTabBar from '$lib/components/organisms/MobileTabBar.svelte';
	import SearchTabBar from '$lib/components/organisms/SearchTabBar.svelte';
	import SearchSortSheet from '$lib/components/molecules/SearchSortSheet.svelte';
	import { isNavActive } from '$lib/utils/nav-active';
	import { resolveDeepHeaderTitle } from '$lib/utils/deep-header-config';
	import { resolveHeaderMode } from '$lib/utils/header-mode';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { getMobilePagerStore } from '$lib/stores/mobile-pager.svelte';
	import { getNavigationStore, backHandler } from '$lib/stores/navigation.svelte';
	import { hopForHref } from '$lib/utils/history-nav';
	import { mdiMagnify, mdiFilterVariant } from '@mdi/js';
	import type { SearchSort, SearchScope } from '$lib/types/search';
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

	const mode = $derived(resolveHeaderMode(currentPath));
	const isSearch = $derived(mode === 'search');
	const isDeep = $derived(mode === 'deep');
	// backMorph is published only while a deep/search swipe-back is in flight; the
	// mode-derived default otherwise keeps SSR + at-rest correct (root -> 1, else 0).
	const morph = $derived(pager.backMorph ?? (mode === 'root' ? 1 : 0));
	const dragging = $derived(pager.dragging);
	const iconProgress = $derived(1 - morph); // BurgerArrowIcon: 0 hamburger, 1 arrow
	const title = $derived(page.data.headerTitle ?? resolveDeepHeaderTitle(currentPath, t) ?? '');
	const slideT = $derived(dragging ? 'none' : 'transform 200ms ease-out');
	// rootLayer (tabs): in place at morph 1, slid up off at morph 0.
	const rootLayerStyle = $derived(
		`transform: translateY(${-(1 - morph) * 100}%); transition: ${slideT}; pointer-events: ${
			morph > 0.5 ? 'auto' : 'none'
		}`
	);
	// deepLayer (title) + searchLayer (input): in place at morph 0, slid down off at morph 1.
	const layerDownStyle = $derived(
		`transform: translateY(${morph * 100}%); transition: ${slideT}; pointer-events: ${
			morph < 0.5 ? 'auto' : 'none'
		}`
	);

	// Search query input: bound to the URL `q`, debounced 250ms before navigating.
	const urlQ = $derived(page.url.searchParams.get('q') ?? '');
	let inputValue = $state(untrack(() => urlQ));
	let lastUrlQ = untrack(() => urlQ);
	let debounceId: ReturnType<typeof setTimeout> | 0 = 0;
	$effect(() => {
		if (urlQ !== lastUrlQ) {
			lastUrlQ = urlQ;
			inputValue = urlQ;
		}
	});
	function commitQuery(q: string): void {
		const params = new SvelteURLSearchParams();
		if (q) params.set('q', q);
		params.set('scope', page.url.searchParams.get('scope') ?? 'discussions');
		params.set('sort', page.url.searchParams.get('sort') ?? 'newest');
		params.set('page', '1');
		void goto(`/search?${params.toString()}`, { replaceState: true, noScroll: true });
	}
	function onInput(event: Event): void {
		inputValue = (event.currentTarget as HTMLInputElement).value;
		if (debounceId) clearTimeout(debounceId);
		debounceId = setTimeout(() => commitQuery(inputValue), 250);
	}
	function onInputKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter') {
			if (debounceId) clearTimeout(debounceId);
			commitQuery(inputValue);
		}
	}

	let filterOpen = $state(false);
	const activeScope = $derived(
		(page.url.searchParams.get('scope') ?? 'discussions') as SearchScope
	);
	const activeSort = $derived((page.url.searchParams.get('sort') ?? 'newest') as SearchSort);
	function onSelectSort(sort: SearchSort): void {
		const params = new SvelteURLSearchParams();
		if (page.url.searchParams.get('q')) params.set('q', page.url.searchParams.get('q') as string);
		params.set('scope', activeScope);
		params.set('sort', sort);
		params.set('page', '1');
		void goto(`/search?${params.toString()}`, { replaceState: true, noScroll: true });
	}

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

	/** Replicates the GesturePageLayout swipe-back commit for the deep-mode back
	 * arrow: let a registered back handler consume it, else hop via the navigation
	 * API, falling back to the site root. */
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
		if (isDeep) {
			onBack();
		} else if (!isSearch) {
			onToggleDrawer();
		}
		// search mode: the magnifier is decorative (no action).
	}

	// Autofocus the search input on entering /search (client-only).
	let inputEl: HTMLInputElement | null = $state(null);
	$effect(() => {
		if (browser && isSearch && inputEl) {
			inputEl.focus();
		}
	});
</script>

<header
	bind:this={headerEl}
	class="sticky top-0 z-40 mx-auto w-full max-w-[960px] px-0 transition-transform duration-200 md:mt-6 md:px-6"
	class:scroll-chrome-scrolling={scrolling}
	style:transform="translateY({translateY}px)"
>
	<div class="bg-neutral text-neutral-content shadow-md md:shadow-none">
		<nav class="flex items-center px-2 py-2 md:items-end md:px-6 md:pt-3 md:pb-2.5">
			<!-- Mobile left slot: hamburger (root) / back arrow (deep) / decorative
			     magnifier (search, non-functional). -->
			{#if isSearch}
				<span
					class="flex size-10 shrink-0 items-center justify-center text-neutral-content/80 md:hidden"
					aria-hidden="true"
				>
					<Icon path={mdiMagnify} size={22} />
				</span>
			{:else}
				<button
					type="button"
					class="flex size-10 shrink-0 items-center justify-center text-neutral-content/80 hover:bg-neutral-content/10 hover:text-neutral-content md:hidden"
					onclick={onLeftButton}
					aria-label={isDeep ? tNav['back'] : tNav['menu']}
				>
					<BurgerArrowIcon progress={iconProgress} {dragging} />
				</button>
			{/if}

			<!-- Desktop: logo + nav links. -->
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

			<!-- Mobile centre: stacked layers cross-faded by morph. -->
			<div class="relative h-10 flex-1 md:hidden">
				<div class="absolute inset-0 flex items-center justify-center" style={rootLayerStyle}>
					<MobileTabBar {t} />
				</div>
				{#if isDeep}
					<div
						class="absolute inset-0 flex items-center justify-center px-2"
						style={layerDownStyle}
					>
						<span class="w-full truncate text-center font-medium text-neutral-content">{title}</span
						>
					</div>
				{/if}
				{#if isSearch}
					<div class="absolute inset-0 flex items-center gap-2 px-2" style={layerDownStyle}>
						<input
							bind:this={inputEl}
							type="text"
							value={inputValue}
							oninput={onInput}
							onkeydown={onInputKeydown}
							placeholder={t.search.placeholder}
							class="input input-sm h-9 flex-1 border-0 bg-neutral-content/10 text-neutral-content placeholder:text-neutral-content/50 focus:outline-none"
							autocomplete="off"
						/>
					</div>
				{/if}
			</div>

			<!-- Mobile right slot: search icon (root) / filter button (search). -->
			{#if isSearch}
				<button
					type="button"
					class="flex size-10 shrink-0 items-center justify-center text-neutral-content/80 hover:bg-neutral-content/10 hover:text-neutral-content md:hidden"
					onclick={() => (filterOpen = true)}
					aria-label={t.search.sortBy}
				>
					<Icon path={mdiFilterVariant} size={22} />
				</button>
			{:else}
				<a
					href="/search"
					class="flex size-10 shrink-0 items-center justify-center text-neutral-content/80 hover:bg-neutral-content/10 hover:text-neutral-content md:hidden"
					aria-label={tNav['search']}
					aria-current={isNavActive(currentPath, '/search') ? 'page' : undefined}
				>
					<Icon path={mdiMagnify} size={22} />
				</a>
			{/if}
		</nav>

		<!-- Mobile search scope strip (search mode only); bg-neutral continues the
		     top bar colour, with the stretchy underline in SearchTabBar. -->
		{#if isSearch}
			<div class="md:hidden">
				<SearchTabBar {t} />
			</div>
		{/if}
	</div>
</header>

<SearchSortSheet
	open={filterOpen}
	{t}
	scope={activeScope}
	sort={activeSort}
	onSelect={onSelectSort}
	onClose={() => (filterOpen = false)}
/>
