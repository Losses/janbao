<script lang="ts">
	/**
	 * Header Organism - the global sticky App Bar (rendered once in AppShell).
	 *
	 * Desktop: logo + navigation links (Activity / Messages / Search).
	 *
	 * Mobile: a 2-panel horizontal track (root panel + search panel, mirrors the
	 * NavPipelineTabHost pattern). The search button is a SINGLE absolutely-positioned
	 * `<a>` that slides from the right edge to the left edge via a `left` CSS
	 * transition: one icon, no duplicate. Entering search slides the track left
	 * (root content exits left, search content pushes in from the right) while the
	 * search button independently travels right-to-left, stopping at the
	 * hamburger's position.
	 *
	 * The root↔deep vertical morph (BurgerArrowIcon + title) lives INSIDE panel 0
	 * but is FROZEN during a search transition (the tabs must exit horizontally
	 * with the track, never float up vertically).
	 *
	 * The SearchTabBar row clip-expands (max-height 0 → auto) rather than jumping.
	 *
	 * RENDER-ONLY (DV20 step 3): the Header is a reader of the pipeline
	 * orchestrator's reactive class fields. The orchestrator owns the
	 * settle ease (the post-release / post-title-change morph + title
	 * crossfade), the root↔search tap-scrub ease, and the `searchScrubbing`
	 * flag; this component reads `orchestrator.settleProgress`,
	 * `orchestrator.settleLatched`, `orchestrator.settleActive`,
	 * `orchestrator.settleDirection`, `pager.tapMorph`, and
	 * `orchestrator.searchScrubbing` and derives every visual from them.
	 * No Header-owned rAF, no Header-owned animation state. §5: one rAF
	 * (the orchestrator's) owns every motion.
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
	import { getCurrentTabIndex } from '$lib/utils/route-config';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { getMobilePagerStore } from '$lib/stores/mobile-pager.svelte';
	import { getNavigationStore, backHandler } from '$lib/stores/navigation.svelte';
	import { getGlobalNavPipelineOrchestrator } from '$lib/stores/nav-pipeline-orchestrator.svelte';
	import { hopForHref } from '$lib/utils/history-nav';
	import { HEADER_MORPH_THRESHOLD } from '$lib/utils/gesture-constants';
	import { mdiMagnify, mdiFilterVariant } from '@mdi/js';
	import type { SearchSort, SearchScope } from '$lib/types/search';
	import type { VoidHandler } from '$lib/types/handlers';
	import type { TranslationDict } from '$lib/types/translation';
	import type { HeaderStateSnapshot } from '$lib/utils/header-probe';

	interface HeaderProps {
		t: TranslationDict;
		onToggleDrawer: VoidHandler;
	}

	let { t, onToggleDrawer }: HeaderProps = $props();

	const scrollChrome = getScrollChromeStore();
	const pager = getMobilePagerStore();
	const navStore = getNavigationStore();
	const orchestrator = getGlobalNavPipelineOrchestrator();
	const tNav = $derived(t.nav);
	const currentPath = $derived(page.url.pathname);
	const translateY = $derived(scrollChrome.translateY);
	const scrolling = $derived(scrollChrome.scrolling);

	const currentHasTabs = $derived(getCurrentTabIndex(currentPath) >= 0);
	const targetHasTabs = $derived(
		navStore.backTarget ? getCurrentTabIndex(navStore.backTarget) >= 0 : false
	);
	const isDeepToDeep = $derived(!currentHasTabs && !targetHasTabs);

	const mode = $derived(resolveHeaderMode(currentPath));
	const isSearch = $derived(mode === 'search');
	const isDeep = $derived(mode === 'deep');
	const dragging = $derived(pager.dragging);
	const title = $derived(page.data.headerTitle ?? resolveDeepHeaderTitle(currentPath, t) ?? '');

	type TitleDirection = 'forward' | 'back';

	// Settle / tap-scrub state comes straight from the orchestrator's
	// reactive class getters. The orchestrator owns the settle ease
	// (the post-release / post-title-change morph + title crossfade),
	// the tap-scrub ease, and the `searchScrubbing` flag; these are
	// class `$state` fields on the orchestrator singleton, read by the
	// Header via the public getters. `orchestrator.settleLatched` carries
	// the endpoint identity frozen at settle-arm; `orchestrator.settleDirection`
	// selects the title-span slide axis.
	const settleActive = $derived(orchestrator.settleActive);
	const settleProgress = $derived(orchestrator.settleProgress);
	const settleLatched = $derived(orchestrator.settleLatched);
	const settleDirection = $derived(orchestrator.settleDirection);
	const searchScrubbing = $derived(orchestrator.searchScrubbing);

	// Header-state notification to the orchestrator. The Header is in a
	// component scope so SvelteKit's `$app/state` `page` reactivity reaches
	// it on every navigation; the orchestrator singleton module's
	// `$effect.root` scope does not see those changes. The Header's
	// `$effect.pre` runs before the render in the same flush, reads the
	// live `currentPath` / `title` / `currentHasTabs` / `isSearch`, and
	// hands them to `orchestrator.notifyHeaderState`. The orchestrator
	// owns the detection logic: it arms the settle ease on a title change
	// and the tap-scrub ease on a root<->search ENTER flip. The drag /
	// drag-cancel / in-flight-settle guards live in the orchestrator. No
	// Header-owned animation state; this Effect is a thin sensor channel.
	$effect.pre(() => {
		// Reactive reads (track page.url.pathname + page.data.* + the
		// local derived tab-ness / search-mode).
		const newPath = currentPath;
		const newTitle = title;
		const tabs = currentHasTabs;
		const search = isSearch;
		const tt = t;
		orchestrator.notifyHeaderState(newPath, newTitle, tabs, search, tt);
	});

	// Morph derivation. Reads `pager.backMorph` while a drag owns the track,
	// the orchestrator's settle publication while a settle owns the crossfade,
	// and the static tab-ness at rest. The root↔search tap scrub does not
	// touch `morph` (the vertical layer group stays out of the horizontal
	// scrub): tapMorph drives the horizontal track via `trackMorph` below.
	const morph = $derived.by(() => {
		if (dragging) {
			return isDeepToDeep ? 0 : (pager.backMorph ?? (currentHasTabs ? 1 : 0));
		}
		if (settleActive && settleLatched) {
			const outgoing = settleLatched.outgoingHasTabs ? 1 : 0;
			const incoming = settleLatched.incomingHasTabs ? 1 : 0;
			return outgoing * (1 - settleProgress) + incoming * settleProgress;
		}
		return currentHasTabs ? 1 : 0;
	});

	// Freeze the icon morph during a search transition. The icon's morph is a
	// root↔deep animation; on a root↔search tap scrub the icon must stay a
	// hamburger at both endpoints. Freeze on `isSearch` (search-mode rest) OR
	// on `searchScrubbing` while on a tab-root page. The `currentHasTabs`
	// term scopes the scrub freeze to tab-root pages, so a scrub in flight
	// when the route is a deep page does not freeze the icon there.
	const iconProgress = $derived(isSearch || (searchScrubbing && currentHasTabs) ? 0 : 1 - morph);

	// Title view model. The drag branch hardcodes direction 'back' (a
	// back-swipe always slides the current title down and brings the back
	// target in from above). The title spans read `progress` directly: during
	// a settle it is the orchestrator-published `settleProgress`, animated
	// frame-by-frame by the orchestrator's settle rAF; during a drag it is
	// `pager.backMorph` (the orchestrator's executor rAF publication); at
	// rest it is 1. No CSS transition is involved on the title spans.
	interface TitleView {
		outgoing: string;
		incoming: string;
		progress: number;
		direction: TitleDirection;
	}

	const currentTitle = $derived(title);
	const backTitle = $derived(
		navStore.backTarget ? (resolveDeepHeaderTitle(navStore.backTarget, t) ?? '') : ''
	);
	const titleView = $derived<TitleView>(
		dragging && backTitle && currentTitle
			? {
					outgoing: currentTitle,
					incoming: backTitle,
					progress: pager.backMorph ?? 0,
					direction: 'back'
				}
			: settleActive
				? {
						outgoing: settleLatched?.outgoingTitle ?? '',
						incoming: settleLatched?.incomingTitle ?? '',
						progress: settleProgress,
						direction: settleDirection
					}
				: {
						outgoing: title,
						incoming: title,
						progress: 1,
						direction: settleDirection
					}
	);

	// Hoisted endpoint-identity source for the layer styles AND the probe: the
	// latched record during a settle (frozen), live at rest. Consuming the SAME
	// derived here means a revert to live in either layer style is observable
	// via effectiveTabsOut/In in the probe (the §7 source-attribution guard).
	const tabsOut = $derived(settleLatched ? settleLatched.outgoingHasTabs : currentHasTabs);
	const tabsIn = $derived(settleLatched ? settleLatched.incomingHasTabs : targetHasTabs);
	// Root↔deep vertical morph: FROZEN in search mode so the tabs exit
	// horizontally with the track, never float up. The transform follows
	// `morph` directly (no `transition:` inline): during a settle `morph`
	// reads the orchestrator-published `settleProgress`; during a drag it
	// reads `pager.backMorph`; at rest it is the static tab-ness value.
	const rootLayerStyle = $derived(
		isSearch
			? 'transform: none; opacity: 1;'
			: `transform: translateY(${
					!(tabsOut || tabsIn) ? -100 : -(1 - morph) * 100
				}%); pointer-events: ${morph > 0.5 && tabsIn ? 'auto' : 'none'}`
	);
	const layerDownStyle = $derived(
		`transform: translateY(${(!tabsOut && !tabsIn ? 0 : morph) * 100}%); pointer-events: ${
			morph < 0.5 ? 'auto' : 'none'
		}`
	);

	// DEV-ONLY probe. Reads every morph-state dep so Svelte re-runs it on each
	// flush they change, pushing a snapshot to window.__headerMorphProbe
	// regardless of whether a paint fires between flushes. The settle /
	// tap-scrub fields come from the orchestrator's pager-store publication.
	// `lastGestureMorph`, `isSettleMode`, and `prevHasTabs` are kept in the
	// snapshot shape (the e2e tests mirror the shape) and carry stable
	// values: `settleActive` is the single settle-mode signal (aliased into
	// `isSettleMode`); the orchestrator seeds `settleProgress` directly from
	// the executor's release-raw, so there is no separate gesture-morph
	// latch (`lastGestureMorph` reads 0); the Header does not track a
	// previous path (`prevHasTabs` mirrors `currentHasTabs`).
	$effect(() => {
		if (!import.meta.env.DEV || !browser) return;
		if (!window.__headerMorphProbe) window.__headerMorphProbe = [];
		const log = window.__headerMorphProbe;
		const snap: HeaderStateSnapshot = {
			t: performance.now(),
			path: currentPath,
			morph,
			rootLayerStyle,
			layerDownStyle,
			settling: settleActive,
			isSettleMode: settleActive,
			settleProgress,
			settleAwaitTitle: orchestrator.settleAwaitTitle,
			lastGestureMorph: 0,
			currentHasTabs,
			targetHasTabs,
			prevHasTabs: currentHasTabs,
			latchedSettle: settleLatched,
			effectiveTabsOut: tabsOut,
			effectiveTabsIn: tabsIn,
			navInFlight: navStore.navInFlight,
			pendingNav: navStore.pendingNav ? navStore.pendingNav.href : null,
			dragging,
			backMorph: pager.backMorph
		};
		log.push(snap);
		if (log.length > 8000) log.shift();
	});

	// Root↔search horizontal track.
	// During an orchestrator-in-flight transition the track reads the
	// executor's own eased publication (pager.backMorph) so it stays
	// frame-synced with the NavPipelineHost Page panel the executor drives.
	// The ENTER and EXIT branches invert because backMorph is the slide
	// progress 0→1 in both directions, while the morph signal (tab-ness) runs
	// 1→0 on a forward-enter (transitionTarget === currentPath, arriving at
	// /search) and 0→1 on a backward-exit (transitionTarget !== currentPath,
	// leaving /search). Outside an orchestrator transition the track falls
	// back to pager.tapMorph (the orchestrator's tap-scrub rAF publication),
	// then to morph (rest / gesture-settle).
	const trackMorph = $derived(
		pager.transitionTarget !== null && pager.backMorph !== null
			? pager.transitionTarget === currentPath
				? 1 - pager.backMorph
				: pager.backMorph
			: pager.tapMorph !== null
				? pager.tapMorph
				: morph
	);
	// searchProgress is the search-layout position the Header renders: 1 when
	// the search panel fills the track, 0 when the root panel fills it. The
	// orchestrator owns the motion; the consumers (track / search button /
	// scope-tab bar) are pure functions of this value. Three sources by
	// precedence:
	//   1. A tap-scrub in flight (pager.tapMorph !== null): tapMorph is
	//      `isSearch`-inverted (1 = not search, 0 = search), so searchProgress
	//      = 1 - tapMorph. Drives the root↔search AND the deep↔search
	//      trajectories (the orchestrator arms the scrub on any isSearch
	//      flip). Reading tapMorph directly (not via trackMorph + isSearch)
	//      is required for the deep↔search EXIT: once the URL lands on a
	//      deep page isSearch is false and the gated fallback below would
	//      clamp to 0; tapMorph drives the slide back to 0 over the scrub.
	//   2. A gesture in flight (transitionTarget + backMorph): follows
	//      trackMorph, gated by isSearch (the gesture rAF runs while the
	//      source route is still mounted, so isSearch matches the
	//      pre-flip endpoint).
	//   3. At rest: isSearch ? 1 : 0.
	const searchProgress = $derived.by(() => {
		if (pager.tapMorph !== null) {
			return 1 - pager.tapMorph;
		}
		if (pager.transitionTarget !== null && pager.backMorph !== null) {
			return isSearch ? 1 - trackMorph : 0;
		}
		return isSearch ? 1 : 0;
	});
	const tabProgress = $derived.by(() => {
		if (pager.tapMorph !== null) {
			return Math.max(0, 1 - pager.tapMorph / HEADER_MORPH_THRESHOLD);
		}
		if (pager.transitionTarget !== null && pager.backMorph !== null) {
			return isSearch ? Math.max(0, 1 - trackMorph / HEADER_MORPH_THRESHOLD) : 0;
		}
		return isSearch ? 1 : 0;
	});

	// Pure functions of searchProgress / tabProgress. No CSS transition: the
	// orchestrator's rAF (gesture rAF or tap-scrub rAF) drives every frame;
	// the styles re-render via Svelte's reactive `style=` binding. §5: no
	// CSS transitions in this layer.
	const trackStyle = $derived(`transform: translateX(${-(searchProgress * 50).toFixed(2)}%);`);

	// The SINGLE search button: absolute, slides from right to left. Driven by
	// the SAME searchProgress as the track so it is sync'd with the rAF.
	// `left` is a linear interp from calc(100% - 3rem) at progress 0 to
	// 0.5rem at progress 1.
	const searchButtonLeft = $derived(
		`calc(${((1 - searchProgress) * 100).toFixed(2)}% - ${((1 - searchProgress) * 3).toFixed(2)}rem + ${(searchProgress * 0.5).toFixed(2)}rem)`
	);
	const searchButtonStyle = $derived(`left: ${searchButtonLeft};`);

	// SearchTabBar row: clip-expand (max-height) driven by tabProgress so it
	// syncs with the track and the search button.
	const tabBarStyle = $derived(`max-height: ${(tabProgress * 3).toFixed(2)}rem;`);

	// Search query input (bind:value + composition gating + debounce + keepFocus).
	const urlQ = $derived(page.url.searchParams.get('q') ?? '');
	let inputValue = $state(untrack(() => urlQ));
	let lastUrlQ = untrack(() => urlQ);
	let composing = $state(false);
	let debounceId: ReturnType<typeof setTimeout> | 0 = 0;
	$effect(() => {
		if (composing) return;
		if (urlQ !== lastUrlQ && urlQ !== inputValue) {
			lastUrlQ = urlQ;
			inputValue = urlQ;
		}
	});
	function commitQuery(q: string): void {
		if (composing) return;
		const params = new SvelteURLSearchParams();
		if (q) params.set('q', q);
		params.set('scope', page.url.searchParams.get('scope') ?? 'discussions');
		params.set('sort', page.url.searchParams.get('sort') ?? 'newest');
		params.set('page', '1');
		void goto(`/search?${params.toString()}`, {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}
	function scheduleCommit(): void {
		if (composing) return;
		if (debounceId) clearTimeout(debounceId);
		debounceId = setTimeout(() => commitQuery(inputValue), 400);
	}
	function onInput(): void {
		scheduleCommit();
	}
	function onCompositionStart(): void {
		composing = true;
	}
	function onCompositionEnd(event: CompositionEvent): void {
		composing = false;
		inputValue = (event.currentTarget as HTMLInputElement).value;
		scheduleCommit();
	}
	function onInputKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && !composing) {
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

	function onBack(): void {
		if (backHandler.dispatch()) return;
		const target = navStore.backTarget;
		if (navStore.activeStack.length > 1) {
			if (hopForHref(target) === 'back') {
				history.back();
			} else {
				pager.setReplaceStateIntent(true);
				void goto(target, { replaceState: true });
			}
		} else {
			pager.setReplaceStateIntent(true);
			void goto('/', { replaceState: true });
		}
	}
	function onLeftButton(): void {
		if (isDeep) onBack();
		else onToggleDrawer();
	}

	let inputEl: HTMLInputElement | null = $state(null);
	$effect(() => {
		if (browser && isSearch && inputEl) inputEl.focus();
	});
</script>

<header
	bind:this={headerEl}
	class="sticky top-0 z-40 mx-auto w-full max-w-[960px] px-0 transition-transform duration-200 md:mt-6 md:px-6"
	class:scroll-chrome-scrolling={scrolling}
	style:transform="translateY({translateY}px)"
>
	<div class="bg-neutral text-neutral-content shadow-md md:shadow-none">
		<!-- Desktop nav -->
		<nav class="hidden items-end gap-6 px-6 pt-3 pb-2.5 md:flex">
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
		</nav>

		<!-- Mobile nav: 2-panel track + single absolute search button. -->
		<div class="relative overflow-clip md:hidden">
			<div class="flex w-[200%]" style={trackStyle}>
				<!-- Panel 0: root/deep content (no search button here; the absolute
				     <a> below covers the right area in root mode). -->
				<div class="flex w-1/2 shrink-0 items-center overflow-hidden px-2 py-2">
					<button
						type="button"
						class="flex size-10 shrink-0 items-center justify-center text-neutral-content/80 hover:bg-neutral-content/10 hover:text-neutral-content"
						onclick={onLeftButton}
						aria-label={isDeep ? tNav['back'] : tNav['menu']}
					>
						<BurgerArrowIcon progress={iconProgress} {dragging} />
					</button>
					<div class="relative h-10 flex-1">
						<div class="absolute inset-0 flex items-center justify-center" style={rootLayerStyle}>
							<MobileTabBar {t} />
						</div>
						<div
							class="absolute inset-0 flex items-center justify-center px-2"
							style={layerDownStyle}
						>
							{#if titleView.outgoing === titleView.incoming}
								<!-- Static title (at rest) -->
								<div class="absolute inset-0 flex items-center justify-center px-2">
									<span class="w-full truncate text-center font-medium text-neutral-content">
										{titleView.incoming}
									</span>
								</div>
							{:else}
								{@const fwd = titleView.direction === 'forward'}
								<!-- Outgoing title. Transform follows titleView.progress
								     (settleProgress during a settle, backMorph during a drag) frame
								     by frame; no CSS transition is involved. -->
								<div
									class="absolute inset-0 flex items-center justify-center px-2"
									style="transform: translateY({(fwd ? -titleView.progress : titleView.progress) *
										100}%);"
								>
									<span class="w-full truncate text-center font-medium text-neutral-content">
										{titleView.outgoing}
									</span>
								</div>

								<!-- Incoming title -->
								<div
									class="absolute inset-0 flex items-center justify-center px-2"
									style="transform: translateY({(fwd
										? 1 - titleView.progress
										: -(1 - titleView.progress)) * 100}%);"
								>
									<span class="w-full truncate text-center font-medium text-neutral-content">
										{titleView.incoming}
									</span>
								</div>
							{/if}
						</div>
					</div>
				</div>

				<!-- Panel 1: search content. pl-14 leaves room for the search button
				     (absolute, at left in search mode). -->
				<div class="flex w-1/2 shrink-0 items-center gap-2 py-2 pr-2 pl-14">
					<input
						bind:this={inputEl}
						bind:value={inputValue}
						type="text"
						oninput={onInput}
						oncompositionstart={onCompositionStart}
						oncompositionend={onCompositionEnd}
						onkeydown={onInputKeydown}
						placeholder={t.search.placeholder}
						class="input input-sm h-9 flex-1 border-0 bg-neutral-content/10 text-neutral-content placeholder:text-neutral-content/50 focus:outline-none"
						autocomplete="off"
					/>
					<button
						type="button"
						class="flex size-10 shrink-0 items-center justify-center text-neutral-content/80 hover:bg-neutral-content/10 hover:text-neutral-content"
						onclick={() => (filterOpen = true)}
						aria-label={t.search.sortBy}
					>
						<Icon path={mdiFilterVariant} size={22} />
					</button>
				</div>
			</div>

			<!-- Single search button: slides from right (root) to left (search =
			     hamburger position) via `left` transition. Always rendered; ONE icon. -->
			<a
				href="/search"
				class="absolute top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center text-neutral-content/80 hover:bg-neutral-content/10 hover:text-neutral-content"
				style={searchButtonStyle}
				aria-label={tNav['search']}
				aria-current={isNavActive(currentPath, '/search') ? 'page' : undefined}
			>
				<Icon path={mdiMagnify} size={22} />
			</a>
		</div>

		<!-- SearchTabBar row: clip-expand via max-height (no mount jump). -->
		<div class="overflow-hidden md:hidden" style={tabBarStyle}>
			<SearchTabBar {t} />
		</div>
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
