<script lang="ts">
	/**
	 * SearchScopePager - the four search-scope panels mounted side-by-side in a
	 * horizontal track, nested inside the `/search` page's `NavPipelineHost`
	 * centre panel (MOBILE ONLY). A drag switches scope 1:1; `?scope=` drives
	 * `activeIndex` (URL = source of truth).
	 *
	 * Animation (DV20 §5): the panel track has NO CSS transition. `visualIndex`
	 * is the authoritative visual position; during a drag it follows the finger
	 * 1:1, and on release or a URL-driven switch a self-owned rAF eases it to
	 * `activeIndex` with the constant-deceleration curve `2u - u²` (the pipeline's
	 * shared commit-ease curve; see `commitEase` in `nav-executor-logic.ts`).
	 * `prefers-reduced-motion`
	 * snaps. The rAF, not CSS, owns the settle phase; during a drag `swipeMove`
	 * writes `visualIndex` directly per `pointermove` (the rAF is cancelled).
	 *
	 * Boundary handoff: `detectSwipe` is given `shouldClaim` + `exclusive`. At the
	 * leftmost scope a rightward drag (the back-swipe direction) YIELDS
	 * (`shouldClaim` returns false → reset to idle, no claim, no stop-prop) so the
	 * bubbled move reaches the ancestor `NavPipelineHost` (via its
	 * `navPipelinePointer` action), which claims it and runs the back-swipe.
	 * `exclusive` shields the ancestor from every inward move so the two never
	 * race to `setPointerCapture`.
	 *
	 * The active scope panel is its own `overflow-y:auto` scroller and claims the
	 * scroll-chrome source via `scrollChrome.setOverride` (the pipeline host's
	 * single `setScrollContainer` $effect reads `override ?? centerEl`).
	 *
	 * Data: the `/search` load returns only the ACTIVE scope; the page cache
	 * holds each visited scope's results keyed by `('/search', scope)` with
	 * the source `(q, sort)` so a swipe back to a visited scope shows them
	 * instantly, and a `q`/`sort` change is a stale-miss (LoadingChip until
	 * the scope is re-activated). Result rendering itself is the shared
	 * `SearchResultsList`.
	 */
	import { onMount, untrack } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import type { Action } from 'svelte/action';
	import { detectSwipe } from '$lib/actions/swipe';
	import { REDUCED_MOTION_QUERY } from '$lib/utils/nav-dom-driver-live';
	import { getSearchPagerStore } from '$lib/stores/mobile-pager.svelte';
	import { getPageCacheStore } from '$lib/stores/page-cache.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { getOnlineStore } from '$lib/stores/online.svelte';
	import { SEARCH_SCOPES, type SearchData, type SearchScope } from '$lib/types/search';
	import { isSearchEntryFresh } from '$lib/utils/search-fresh';
	import type { SearchScopeCacheData } from '$lib/types/page-cache-shapes';
	import LoadingChip from '$lib/components/atoms/LoadingChip.svelte';
	import SearchResultsList from '$lib/components/molecules/SearchResultsList.svelte';
	import { mdiMagnify } from '@mdi/js';

	interface SearchScopePagerProps {
		data: SearchData;
	}

	let { data }: SearchScopePagerProps = $props();

	const pager = getSearchPagerStore();
	const pageCache = getPageCacheStore();
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
	/** Authoritative visual position of the panel track in scope units
	 *  (0 = discussions visible, 1 = activities, ...). During a drag
	 *  `swipeMove` writes this directly per `pointermove`; the rAF below
	 *  eases it to `activeIndex` on release or a URL-driven switch. */
	let visualIndex = $state(untrack(() => scopeIndex(data.scope)));
	/** Finger-down flag: true during a drag (1:1 follow, underline stretches),
	 *  false during a settle. Published as the pager store's `dragging`. */
	let isDragging = $state(false);
	let viewportWidth = $state(0);
	let panelEls = $state<(HTMLElement | null)[]>(SEARCH_SCOPES.map(() => null));

	// Lazy panel content: the four `<section>` shells always mount (they own
	// the track geometry, the `bind:this` refs `scrollChrome.setOverride`
	// consumes, and the per-scope `data-scope-panel` markers), but their
	// inner content (LoadingChip or SearchResultsList) only mounts for panels
	// the user can actually see. At rest that is exactly the active scope;
	// during a drag the destination scope joins (Math.round(visualIndex));
	// once a scope has been active it stays renderable so a back-swipe to a
	// visited scope shows its content instantly instead of re-mounting it
	// mid-slide. Seeded with the URL scope so SSR and the first client render
	// agree on which panel renders content (no hydration mismatch), and only
	// the active panel's content mounts on the search-APPEAR frame (mounting
	// all four panels' content eagerly would dominate the click frame under
	// 4x CPU; the LoAF bar in scripts/measure-search-jank.ts enforces a
	// 150ms worst-frame budget at 4x CPU in the production build).
	let visitedScopes = $state<ReadonlySet<SearchScope>>(
		untrack(() => new Set<SearchScope>([data.scope]))
	);
	$effect(() => {
		const current = SEARCH_SCOPES[activeIndex];
		if (!visitedScopes.has(current)) {
			visitedScopes = new Set<SearchScope>([...visitedScopes, current]);
		}
	});

	/** A panel's content renders when it is the active scope, the in-flight
	 *  swipe destination, or a previously visited scope. */
	function shouldRenderPanel(idx: number): boolean {
		if (idx === activeIndex) return true;
		if (idx === Math.round(visualIndex)) return true;
		return visitedScopes.has(SEARCH_SCOPES[idx]);
	}

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
			if (i !== activeIndex) {
				activeIndex = i;
				settleTo(i);
			}
		});
	});

	// Publish the active scope's loaded results to the cache (keyed by
	// `/search` + scope, with the source q/sort so a later change is
	// detected as a stale-miss by `isFresh`).
	$effect(() => {
		const base = {
			page: data.page,
			totalPages: data.totalPages,
			total: data.total,
			usedFallback: data.usedFallback,
			q: data.query,
			sort: data.sort
		};
		const scope = data.scope;
		const payload: SearchScopeCacheData | null = (() => {
			switch (scope) {
				case 'discussions':
					return data.discussions ? { items: data.discussions, ...base } : null;
				case 'activities':
					return data.activities ? { items: data.activities, ...base } : null;
				case 'messages':
					return data.messages ? { items: data.messages, ...base } : null;
				case 'users':
					return data.users ? { items: data.users, ...base } : null;
			}
		})();
		if (payload) {
			// `capture` merges into the cache (a read+write of the cache's
			// $state). Untrack it so this effect subscribes only to `data`
			// (re-runs on navigation) and not to the cache (which would
			// loop: effect_update_depth_exceeded). Same fix as the
			// cache-seeding effect in src/routes/+layout.svelte.
			untrack(() => {
				pageCache.capture('/search', scope, {
					data: payload,
					source: { route: '/search', query: data.query, sort: data.sort, page: data.page }
				});
			});
		}
	});

	// Publish the visual position to the search pager store so SearchTabBar's
	// underline tracks the track continuously, during both a drag and a settle.
	// backMorph stays null: this is the search-scope sub-pager (orthogonal to
	// the primary pager the Header reads for `backMorph`), and scope switching
	// does not morph the header. The primary pager's `backMorph` is owned by
	// the orchestrator, which publishes the live drag fraction on every
	// NavPipelineHost / NavPipelineTabHost drag that morphs the header.
	$effect(() => {
		pager.set({
			fractionalIndex: visualIndex,
			dragging: isDragging,
			active: true,
			backMorph: null
		});
	});

	onMount(() => {
		pager.set({ fractionalIndex: activeIndex, dragging: false, active: true, backMorph: null });
		return () => {
			cancelSettle();
			pager.set({ fractionalIndex: 0, dragging: false, active: false, backMorph: null });
			scrollChrome.setOverride(null);
		};
	});

	// The active scope panel claims the scroll-chrome source. Keyed on
	// activeIndex so it re-runs on scope switch; the pipeline host's single
	// setScrollContainer $effect reads this override, so registration is
	// race-free regardless of parent/child $effect ordering.
	$effect(() => {
		const idx = activeIndex;
		scrollChrome.setOverride(panelEls[idx]);
	});

	/** Claim every drag EXCEPT a rightward drag at the leftmost scope, which is the
	 *  back-swipe direction and must reach the ancestor NavPipelineHost. */
	function shouldClaim(dx: number): boolean {
		if (activeIndex === 0 && dx > 0) return false;
		return true;
	}

	/** 1:1 in the middle; 0.4x rubber-band past the rightmost scope (no neighbour). */
	function follow(deltaX: number): number {
		if (activeIndex === LAST && deltaX < 0) return deltaX * 0.4;
		return deltaX;
	}

	// ---------------------------------------------------------------------
	// Scope-switch settle (DV20 §5). The panel track reads `visualIndex`;
	// this self-owned rAF eases it to `activeIndex` after a drag release or
	// a URL-driven switch. One rAF per motion channel, the same invariant
	// the orchestrator upholds.
	// ---------------------------------------------------------------------

	const SCOPE_SETTLE_MS = 200;
	let settleRafId: number | undefined;

	function cancelSettle(): void {
		if (settleRafId !== undefined) {
			cancelAnimationFrame(settleRafId);
			settleRafId = undefined;
		}
	}

	function prefersReducedMotion(): boolean {
		if (!browser) return false;
		return window.matchMedia(REDUCED_MOTION_QUERY).matches;
	}

	/** Ease `visualIndex` to `target` over `SCOPE_SETTLE_MS` with the
	 *  constant-deceleration curve `2u - u²` (the pipeline's shared
	 *  commit-ease curve; see `commitEase` in `nav-executor-logic.ts`).
	 * Cancels any in-flight settle first
	 *  so a re-grab or a new target mid-settle interrupts cleanly. Reduced
	 *  motion snaps to the target with no rAF. */
	function settleTo(target: number): void {
		if (!browser) return;
		cancelSettle();
		if (visualIndex === target) return;
		if (prefersReducedMotion()) {
			visualIndex = target;
			return;
		}
		const from = visualIndex;
		let startTs = 0;
		const tick = (): void => {
			const now = performance.now();
			if (startTs === 0) startTs = now;
			const u = Math.min((now - startTs) / SCOPE_SETTLE_MS, 1);
			const eased = 2 * u - u * u;
			visualIndex = from + (target - from) * eased;
			if (u >= 1) {
				settleRafId = undefined;
				return;
			}
			settleRafId = requestAnimationFrame(tick);
		};
		settleRafId = requestAnimationFrame(tick);
	}

	function swipeMove(deltaX: number): void {
		scrollChrome.show();
		// A re-grab mid-settle interrupts the easing rAF and resumes 1:1 follow
		// from the current pointer position. The track anchors at `activeIndex`
		// for deltaX = 0 (DV20 §5 interruption).
		cancelSettle();
		isDragging = true;
		visualIndex = activeIndex - follow(deltaX) / (viewportWidth || 1);
	}

	function swipeEnd(deltaX: number, _velocity: number, reversed: boolean): void {
		isDragging = false;
		if (deltaX >= SWIPE_COMMIT && activeIndex > 0 && !reversed) {
			switchTo(activeIndex - 1);
		} else if (deltaX <= -SWIPE_COMMIT && activeIndex < LAST && !reversed) {
			switchTo(activeIndex + 1);
		} else {
			settleTo(activeIndex);
		}
	}

	function switchTo(index: number): void {
		activeIndex = index;
		settleTo(index);
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

	// The panel track reads `visualIndex` (the visual position) directly. No
	// transition property: during a drag `visualIndex` is `pointermove`-driven
	// (`swipeMove` writes it directly); the settle rAF owns the settle phase.
	const trackStyle = $derived(`transform: translateX(-${visualIndex * STEP_PERCENT}%)`);

	const measureViewport: Action<HTMLElement> = (node) => {
		const update = () => {
			viewportWidth = node.clientWidth;
		};
		// Defer the initial width read to the next animation frame. Calling
		// `update()` synchronously on mount reads `clientWidth` after the host
		// just mounted a batch of DOM (the four scope panels, the track, the
		// panels' content) and that read forces the browser to flush the
		// pending layout work; under mobile-class CPU that forced reflow
		// stacks with the other geometry reads on this path and pushes the
		// search-enter frame past its budget. The ResizeObserver fires its
		// first callback on the next frame anyway, so the rAF below only
		// aligns the seed with that cadence; no setTimeout, no CSS transition.
		// `viewportWidth` is consumed by `swipeMove`'s 1:1 follow, which only
		// runs once a drag starts (a drag always starts after this rAF has
		// run), so the deferral has no observable effect.
		window.requestAnimationFrame(update);
		const ro = new ResizeObserver(update);
		ro.observe(node);
		return {
			destroy() {
				ro.disconnect();
			}
		};
	};

	function fresh(scope: SearchScope): boolean {
		const entry = pageCache.get('/search', scope);
		return isSearchEntryFresh(entry?.source ?? null, data.query, data.sort);
	}

	const hasQuery = $derived(query.trim().length > 0);

	// Per-scope typed views over the page cache. Each is `null` when no
	// entry has been captured for that scope, or when the entry's source
	// does not match the current `(q, sort)` (the panel reloads).
	const discussionsScope = $derived(
		pageCache.get('/search', 'discussions')?.data as SearchScopeCacheData | null | undefined
	);
	const activitiesScope = $derived(
		pageCache.get('/search', 'activities')?.data as SearchScopeCacheData | null | undefined
	);
	const messagesScope = $derived(
		pageCache.get('/search', 'messages')?.data as SearchScopeCacheData | null | undefined
	);
	const usersScope = $derived(
		pageCache.get('/search', 'users')?.data as SearchScopeCacheData | null | undefined
	);
</script>

<div
	data-search-scope-pager
	class="search-scope-pager-viewport h-full w-full"
	style="touch-action: pan-y pinch-zoom; overflow: clip; height: 100%; position: relative;"
	use:detectSwipe={{ onMove: swipeMove, onEnd: swipeEnd, shouldClaim, exclusive: true }}
	use:measureViewport
>
	<div class="flex h-full w-[400%] items-start" style={trackStyle}>
		<section
			bind:this={panelEls[0]}
			data-scope-panel="discussions"
			class="scroll-pane h-full overflow-y-auto"
			style="width: 25%; touch-action: pan-y pinch-zoom; -webkit-overflow-scrolling: touch;"
		>
			{#if shouldRenderPanel(0)}
				<div class="p-3">
					{#if online.online && hasQuery && !fresh('discussions')}
						<div class="flex justify-center py-10"><LoadingChip icon={mdiMagnify} /></div>
					{:else}
						<SearchResultsList
							scope="discussions"
							items={discussionsScope?.items ?? null}
							{query}
							page={discussionsScope?.page ?? 1}
							totalPages={discussionsScope?.totalPages ?? 0}
							total={discussionsScope?.total ?? 0}
							online={online.online}
							{t}
							onPageChange={(p) => handlePage('discussions', p)}
						/>
					{/if}
				</div>
			{/if}
		</section>
		<section
			bind:this={panelEls[1]}
			data-scope-panel="activities"
			class="scroll-pane h-full overflow-y-auto"
			style="width: 25%; touch-action: pan-y pinch-zoom; -webkit-overflow-scrolling: touch;"
		>
			{#if shouldRenderPanel(1)}
				<div class="p-3">
					{#if online.online && hasQuery && !fresh('activities')}
						<div class="flex justify-center py-10"><LoadingChip icon={mdiMagnify} /></div>
					{:else}
						<SearchResultsList
							scope="activities"
							items={activitiesScope?.items ?? null}
							{query}
							page={activitiesScope?.page ?? 1}
							totalPages={activitiesScope?.totalPages ?? 0}
							total={activitiesScope?.total ?? 0}
							online={online.online}
							{t}
							onPageChange={(p) => handlePage('activities', p)}
						/>
					{/if}
				</div>
			{/if}
		</section>
		<section
			bind:this={panelEls[2]}
			data-scope-panel="messages"
			class="scroll-pane h-full overflow-y-auto"
			style="width: 25%; touch-action: pan-y pinch-zoom; -webkit-overflow-scrolling: touch;"
		>
			{#if shouldRenderPanel(2)}
				<div class="p-3">
					{#if online.online && hasQuery && !fresh('messages')}
						<div class="flex justify-center py-10"><LoadingChip icon={mdiMagnify} /></div>
					{:else}
						<SearchResultsList
							scope="messages"
							items={messagesScope?.items ?? null}
							{query}
							page={messagesScope?.page ?? 1}
							totalPages={messagesScope?.totalPages ?? 0}
							total={messagesScope?.total ?? 0}
							online={online.online}
							{t}
							onPageChange={(p) => handlePage('messages', p)}
						/>
					{/if}
				</div>
			{/if}
		</section>
		<section
			bind:this={panelEls[3]}
			data-scope-panel="users"
			class="scroll-pane h-full overflow-y-auto"
			style="width: 25%; touch-action: pan-y pinch-zoom; -webkit-overflow-scrolling: touch;"
		>
			{#if shouldRenderPanel(3)}
				<div class="p-3">
					{#if online.online && hasQuery && !fresh('users')}
						<div class="flex justify-center py-10"><LoadingChip icon={mdiMagnify} /></div>
					{:else}
						<SearchResultsList
							scope="users"
							items={usersScope?.items ?? null}
							{query}
							page={usersScope?.page ?? 1}
							totalPages={usersScope?.totalPages ?? 0}
							total={usersScope?.total ?? 0}
							online={online.online}
							{t}
							onPageChange={(p) => handlePage('users', p)}
						/>
					{/if}
				</div>
			{/if}
		</section>
	</div>
</div>
