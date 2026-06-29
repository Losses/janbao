<script lang="ts">
	/**
	 * SearchScopePager - the four search-scope panels mounted side-by-side in a
	 * horizontal track (a sibling of `MobileTabPager`), hosted inside the
	 * `/search` page's `GesturePageLayout` centre panel (MOBILE ONLY). A drag
	 * switches scope 1:1; `?scope=` drives `activeIndex` (URL = source of truth).
	 *
	 * Boundary handoff: `detectSwipe` is given `shouldClaim` + `exclusive`. At the
	 * leftmost scope a rightward drag (the back-swipe direction) YIELDS
	 * (`shouldClaim` returns false → reset to idle, no claim, no stop-prop) so the
	 * bubbled move reaches the ancestor `GesturePageLayout`, which claims it and
	 * runs its unchanged back-swipe (preview / chip). `exclusive` shields the
	 * ancestor from every inward move so the two never race to `setPointerCapture`
	 * (the c05594c slicing race).
	 *
	 * The active scope panel is its own `overflow-y:auto` scroller and claims the
	 * scroll-chrome source via `scrollChrome.setOverride` (GesturePageLayout's
	 * single `setScrollContainer` $effect reads `override ?? centerEl`).
	 *
	 * Data: the `/search` load returns only the ACTIVE scope; `search-cache` holds
	 * each visited scope's results keyed by `(scope, q, sort)` so a swipe back to a
	 * visited scope shows them instantly, and a `q`/`sort` change is a stale-miss
	 * (LoadingChip until the scope is re-activated). Result rendering itself is the
	 * shared `SearchResultsList`.
	 */
	import { onMount, untrack } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import type { Action } from 'svelte/action';
	import { detectSwipe } from '$lib/actions/swipe';
	import { getSearchPagerStore } from '$lib/stores/mobile-pager.svelte';
	import { getSearchCacheStore } from '$lib/stores/search-cache.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import { SEARCH_SCOPES, type SearchData, type SearchScope } from '$lib/types/search';
	import LoadingChip from '$lib/components/atoms/LoadingChip.svelte';
	import SearchResultsList from '$lib/components/molecules/SearchResultsList.svelte';
	import { mdiMagnify } from '@mdi/js';

	interface SearchScopePagerProps {
		data: SearchData;
	}

	let { data }: SearchScopePagerProps = $props();

	const pager = getSearchPagerStore();
	const cache = getSearchCacheStore();
	const scrollChrome = getScrollChromeStore();
	const online = getOnlineStore();

	const t = $derived(data.t);
	const query = $derived(data.query);

	const STEP_PERCENT = 100 / SEARCH_SCOPES.length;
	const SWIPE_COMMIT = 60;
	const LAST = SEARCH_SCOPES.length - 1;

	function scopeIndex(s: SearchScope): number {
		const i = SEARCH_SCOPES.indexOf(s);
		return i < 0 ? 0 : i;
	}

	let activeIndex = $state(untrack(() => scopeIndex(data.scope)));
	let dragOffset = $state<number | null>(null);
	let viewportWidth = $state(0);
	let panelEls = $state<(HTMLElement | null)[]>(SEARCH_SCOPES.map(() => null));

	// Sync activeIndex from the URL (deep link / browser back-forward). Writes
	// activeIndex only, gated on a scope change so a programmatic switch (which
	// sets activeIndex before the load resolves) is not overridden mid-flight.
	let lastScope = untrack(() => data.scope);
	$effect(() => {
		const s = data.scope;
		if (s === lastScope) return;
		lastScope = s;
		untrack(() => {
			const i = scopeIndex(s);
			if (i !== activeIndex) activeIndex = i;
		});
	});

	// Publish the active scope's loaded results to the cache (keyed by scope, with
	// the source q/sort so a later change is detected as a stale-miss).
	$effect(() => {
		const base = {
			page: data.page,
			totalPages: data.totalPages,
			total: data.total,
			usedFallback: data.usedFallback,
			q: data.query,
			sort: data.sort
		};
		switch (data.scope) {
			case 'discussions':
				if (data.discussions) cache.setDiscussions({ items: data.discussions, ...base });
				break;
			case 'activities':
				if (data.activities) cache.setActivities({ items: data.activities, ...base });
				break;
			case 'messages':
				if (data.messages) cache.setMessages({ items: data.messages, ...base });
				break;
			case 'users':
				if (data.users) cache.setUsers({ items: data.users, ...base });
				break;
		}
	});

	// Publish drag progress to the search pager store so SearchTabBar's underline
	// tracks the finger. backMorph stays null: scope switching does not morph the
	// header (only the GesturePageLayout back-swipe does, via the primary store).
	$effect(() => {
		pager.set({
			fractionalIndex: activeIndex - (dragOffset ?? 0) / (viewportWidth || 1),
			dragging: dragOffset !== null,
			active: true,
			backMorph: null
		});
	});

	onMount(() => {
		pager.set({ fractionalIndex: activeIndex, dragging: false, active: true, backMorph: null });
		return () => {
			pager.set({ fractionalIndex: 0, dragging: false, active: false, backMorph: null });
			scrollChrome.setOverride(null);
		};
	});

	// The active scope panel claims the scroll-chrome source. Keyed on
	// activeIndex so it re-runs on scope switch; GesturePageLayout's single
	// setScrollContainer $effect reads this override, so registration is
	// race-free regardless of parent/child $effect ordering.
	$effect(() => {
		const idx = activeIndex;
		scrollChrome.setOverride(panelEls[idx]);
	});

	/** Claim every drag EXCEPT a rightward drag at the leftmost scope, which is the
	 *  back-swipe direction and must reach the ancestor GesturePageLayout. */
	function shouldClaim(dx: number): boolean {
		if (activeIndex === 0 && dx > 0) return false;
		return true;
	}

	/** 1:1 in the middle; 0.4x rubber-band past the rightmost scope (no neighbour). */
	function follow(deltaX: number): number {
		if (activeIndex === LAST && deltaX < 0) return deltaX * 0.4;
		return deltaX;
	}

	function swipeMove(deltaX: number): void {
		scrollChrome.show();
		dragOffset = follow(deltaX);
	}

	function swipeEnd(deltaX: number, _velocity: number, reversed: boolean): void {
		if (deltaX >= SWIPE_COMMIT && activeIndex > 0 && !reversed) {
			switchTo(activeIndex - 1);
		} else if (deltaX <= -SWIPE_COMMIT && activeIndex < LAST && !reversed) {
			switchTo(activeIndex + 1);
		}
		dragOffset = null;
	}

	function switchTo(index: number): void {
		activeIndex = index;
		const params = new SvelteURLSearchParams();
		if (data.query) params.set('q', data.query);
		params.set('scope', SEARCH_SCOPES[index]);
		params.set('sort', data.sort);
		params.set('page', '1');
		void goto(`/search?${params.toString()}`, { replaceState: true, noScroll: true });
	}

	function handlePage(scope: SearchScope, newPage: number): void {
		const params = new SvelteURLSearchParams();
		if (data.query) params.set('q', data.query);
		params.set('scope', scope);
		params.set('sort', data.sort);
		params.set('page', String(newPage));
		void goto(`/search?${params.toString()}`, { replaceState: true, noScroll: true });
	}

	const trackTranslateX = $derived(
		dragOffset === null
			? `-${activeIndex * STEP_PERCENT}%`
			: `calc(-${activeIndex * STEP_PERCENT}% + ${dragOffset}px)`
	);
	const trackStyle = $derived(
		dragOffset !== null
			? `transform: translateX(${trackTranslateX}); transition: none`
			: `transform: translateX(${trackTranslateX})`
	);

	const measureViewport: Action<HTMLElement> = (node) => {
		const update = () => {
			viewportWidth = node.clientWidth;
		};
		update();
		const ro = new ResizeObserver(update);
		ro.observe(node);
		return {
			destroy() {
				ro.disconnect();
			}
		};
	};

	function fresh(scope: SearchScope): boolean {
		return cache.isFresh(scope, data.query, data.sort);
	}

	const hasQuery = $derived(query.trim().length > 0);
</script>

<div
	data-search-scope-pager
	class="search-scope-pager-viewport h-full w-full"
	style="touch-action: pan-y pinch-zoom; overflow: clip; height: 100%; position: relative;"
	use:detectSwipe={{ onMove: swipeMove, onEnd: swipeEnd, shouldClaim, exclusive: true }}
	use:measureViewport
>
	<div
		class="flex h-full w-[400%] items-start transition-transform duration-200"
		style={trackStyle}
	>
		<section
			bind:this={panelEls[0]}
			data-scope-panel="discussions"
			class="scroll-pane h-full overflow-y-auto"
			style="width: 25%; touch-action: pan-y pinch-zoom; -webkit-overflow-scrolling: touch;"
		>
			<div class="p-3">
				{#if online.online && hasQuery && !fresh('discussions')}
					<div class="flex justify-center py-10"><LoadingChip icon={mdiMagnify} /></div>
				{:else}
					<SearchResultsList
						scope="discussions"
						items={cache.discussions?.items ?? null}
						{query}
						page={cache.discussions?.page ?? 1}
						totalPages={cache.discussions?.totalPages ?? 0}
						total={cache.discussions?.total ?? 0}
						online={online.online}
						{t}
						onPageChange={(p) => handlePage('discussions', p)}
					/>
				{/if}
			</div>
		</section>
		<section
			bind:this={panelEls[1]}
			data-scope-panel="activities"
			class="scroll-pane h-full overflow-y-auto"
			style="width: 25%; touch-action: pan-y pinch-zoom; -webkit-overflow-scrolling: touch;"
		>
			<div class="p-3">
				{#if online.online && hasQuery && !fresh('activities')}
					<div class="flex justify-center py-10"><LoadingChip icon={mdiMagnify} /></div>
				{:else}
					<SearchResultsList
						scope="activities"
						items={cache.activities?.items ?? null}
						{query}
						page={cache.activities?.page ?? 1}
						totalPages={cache.activities?.totalPages ?? 0}
						total={cache.activities?.total ?? 0}
						online={online.online}
						{t}
						onPageChange={(p) => handlePage('activities', p)}
					/>
				{/if}
			</div>
		</section>
		<section
			bind:this={panelEls[2]}
			data-scope-panel="messages"
			class="scroll-pane h-full overflow-y-auto"
			style="width: 25%; touch-action: pan-y pinch-zoom; -webkit-overflow-scrolling: touch;"
		>
			<div class="p-3">
				{#if online.online && hasQuery && !fresh('messages')}
					<div class="flex justify-center py-10"><LoadingChip icon={mdiMagnify} /></div>
				{:else}
					<SearchResultsList
						scope="messages"
						items={cache.messages?.items ?? null}
						{query}
						page={cache.messages?.page ?? 1}
						totalPages={cache.messages?.totalPages ?? 0}
						total={cache.messages?.total ?? 0}
						online={online.online}
						{t}
						onPageChange={(p) => handlePage('messages', p)}
					/>
				{/if}
			</div>
		</section>
		<section
			bind:this={panelEls[3]}
			data-scope-panel="users"
			class="scroll-pane h-full overflow-y-auto"
			style="width: 25%; touch-action: pan-y pinch-zoom; -webkit-overflow-scrolling: touch;"
		>
			<div class="p-3">
				{#if online.online && hasQuery && !fresh('users')}
					<div class="flex justify-center py-10"><LoadingChip icon={mdiMagnify} /></div>
				{:else}
					<SearchResultsList
						scope="users"
						items={cache.users?.items ?? null}
						{query}
						page={cache.users?.page ?? 1}
						totalPages={cache.users?.totalPages ?? 0}
						total={cache.users?.total ?? 0}
						online={online.online}
						{t}
						onPageChange={(p) => handlePage('users', p)}
					/>
				{/if}
			</div>
		</section>
	</div>
</div>
