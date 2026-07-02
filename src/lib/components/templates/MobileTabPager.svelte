<script lang="ts">
	/**
	 * MobileTabPager - All three primary tabs mounted side-by-side in a horizontal
	 * track so a drag reveals the neighbour live (1:1) and panel state (e.g. the
	 * Activity composer) survives a switch. Rendered only on mobile by the
	 * `(tabs)` layout; desktop renders each route's own page.
	 *
	 * The track is 3x the viewport wide; each `<section>` is 1/3 of it (= one
	 * viewport). Position is driven by an inline `transform` (Tailwind v4's
	 * translate-x-* uses the native `translate` property and would compose with,
	 * not override, an inline `transform`). `overflow-hidden` hides the neighbour
	 * panels (horizontal) AND clips the taller track's vertical overflow - without
	 * it, a taller off-screen panel would extend the document and leave scrollable
	 * blank under a shorter active tab. The viewport is at least the content-area
	 * height (min-height: 100%), so a short panel still fills the screen and its
	 * swipe surface reaches the bottom - the space below short content stays
	 * inside the viewport and stays gesture-interactive; for a tall panel the
	 * measured height takes over and the window (not the viewport) scrolls.
	 *
	 * Data: the layout load (input-free, reused across swipes) supplies page 1 of
	 * every tab so a drag is instant and never refetches. The ACTIVE tab's current
	 * page (incl. `?page` pagination) comes from that route's own page load via the
	 * `page` store, applied only once the swipe has settled (activeIndex matches
	 * the URL) so there is no race mid-transition. The paginator is shown only on
	 * the active panel.
	 */
	import { onMount, onDestroy, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import type { Action } from 'svelte/action';
	import { detectSwipe } from '$lib/actions/swipe';
	import { getMobilePagerStore } from '$lib/stores/mobile-pager.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { getPageScrollStore } from '$lib/stores/page-scroll.svelte';
	import { viewportLock } from '$lib/stores/viewport-lock.svelte';
	import { getNavigationStore } from '$lib/stores/navigation.svelte';
	import {
		setActiveGestureTrack,
		clearActiveGestureTrack
	} from '$lib/stores/active-gesture-track.svelte';
	import { MOBILE_TABS, getCurrentTabIndex } from '$lib/utils/route-config';
	import { backSwipeShouldPopHistory } from '$lib/utils/history-nav';
	import { getDeepPageSnapshotStore } from '$lib/stores/deep-page-snapshot.svelte';
	import DiscussionsPanel from '$lib/components/panels/DiscussionsPanel.svelte';
	import ActivityPanel from '$lib/components/panels/ActivityPanel.svelte';
	import MessagesPanel from '$lib/components/panels/MessagesPanel.svelte';
	import LoadingChip from '$lib/components/atoms/LoadingChip.svelte';
	import { mdiArrowLeft } from '@mdi/js';
	import type { PageUrlBuilder, TabsLayoutData } from '$lib/types/tabs';
	import type { TranslationDict } from '$lib/types/translation';
	import type { UserInfoSummary } from '$lib/types/api';

	interface MobileTabPagerProps {
		data: TabsLayoutData;
		t: TranslationDict;
		user: UserInfoSummary | null;
	}

	let { data, t, user }: MobileTabPagerProps = $props();

	const STEP_PERCENT = 100 / MOBILE_TABS.length;
	const SWIPE_COMMIT = 60; // px past which a release commits the switch

	function initialIndex(): number {
		const idx = getCurrentTabIndex(page.url.pathname);
		return idx < 0 ? 0 : idx;
	}

	let activeIndex = $state(initialIndex());
	// null at rest (CSS transition snaps to activeIndex); a live px offset while a
	// pointer is dragging, applied in the transform so the track tracks 1:1.
	let dragOffset = $state<number | null>(null);
	// True during a back-swipe toward a deep page that has a cached snapshot.
	// The snapshot overlays section 0 (Discussions) so the normal track-slide
	// reveals the actual destination page, reusing the existing two-panel sliding
	// motion (NOT a separate width-clip animation).
	let showDeepPreview = $state(false);
	let deepPreviewEl = $state<HTMLElement | null>(null);
	// The horizontal track element. Published to the active-gesture-track store
	// so an ancestor can sample its transform during the snap CSS transition
	// (the AppShell gesture-surface consumer reads it to derive a continuous
	// fraction across the transition). Bound below on the track div.
	let trackEl = $state<HTMLElement | null>(null);
	// px width of the back chip overlay during a back-swipe toward a DEEP page
	// when no cached snapshot is available; null at rest.
	let backChipReveal = $state<number | null>(null);

	// Publish drag progress to the shared store so MobileTabBar's indicator
	// tracks the finger. fractionalIndex = active tab + fractional drag offset
	// (in panel widths); dragging drops the bar's CSS transition for 1:1 follow.
	// Tab routes are always root-mode for the Header, so backMorph stays null
	// here (the morph is driven only by deep-page swipe-back in GesturePageLayout).
	const pager = getMobilePagerStore();
	const deepPageSnapshot = getDeepPageSnapshotStore();
	const navStore = getNavigationStore();
	const scrollChrome = getScrollChromeStore();
	const pageScrollStore = getPageScrollStore();
	let section0El = $state<HTMLElement | null>(null);
	let section1El = $state<HTMLElement | null>(null);
	let section2El = $state<HTMLElement | null>(null);
	let viewportWidth = $state(0);
	$effect(() => {
		pager.set({
			fractionalIndex: activeIndex - (dragOffset ?? 0) / (viewportWidth || 1),
			dragging: dragOffset !== null || backChipReveal !== null,
			active: true,
			backMorph: null
		});
	});
	// When the deep-page preview overlay appears, restore the thread's scroll
	// position so the preview shows the thread where the user left it.
	$effect(() => {
		if (deepPreviewEl && showDeepPreview) {
			deepPreviewEl.scrollTop = deepPageSnapshot.scrollTop;
		}
	});
	// Per-panel scroll restore + hide-on-scroll registration. Re-runs when
	// activeIndex changes (tab switch) or the section element binds. Restores the
	// active panel's saved scroll from pageScrollStore (sync + rAF, mirrors
	// GesturePageLayout :286-296 to avoid a top-flash on remount) and registers it
	// as the scroll-chrome source (hide-on-scroll reads this panel).
	$effect(() => {
		const el = activeIndex === 0 ? section0El : activeIndex === 1 ? section1El : section2El;
		if (!el) return;
		const saved = pageScrollStore.get(MOBILE_TABS[activeIndex].href);
		if (saved > 0) {
			el.scrollTop = saved;
			requestAnimationFrame(() => {
				const current =
					activeIndex === 0 ? section0El : activeIndex === 1 ? section1El : section2El;
				if (current === el) el.scrollTop = saved;
			});
		}
		scrollChrome.setScrollContainer(el);
	});
	onMount(() => {
		viewportLock.acquire();
		const initialEl = activeIndex === 0 ? section0El : activeIndex === 1 ? section1El : section2El;
		if (initialEl) scrollChrome.setScrollContainer(initialEl);
		pager.set({ fractionalIndex: activeIndex, dragging: false, active: true, backMorph: null });
		return () => pager.set({ fractionalIndex: 0, dragging: false, active: false, backMorph: null });
	});
	// Publish the bound track element to the active-gesture-track store. Re-runs
	// when trackEl binds/unbinds (HMR, remount). Cleared in onDestroy.
	$effect(() => {
		if (trackEl) setActiveGestureTrack(trackEl);
	});
	onDestroy(() => {
		// onDestroy runs during SSR render. clearActiveGestureTrack only nulls
		// $state (no DOM touch) and trackEl === null on SSR short-circuits the
		// branch, but the guard mirrors the active-gesture-track consumer contract
		// (svelte-ondestroy-runs-in-ssr memory) and the AppShell layer's pattern.
		if (!browser) return;
		viewportLock.release();
		scrollChrome.setScrollContainer(null);
		if (trackEl) clearActiveGestureTrack();
	});

	// Sync from the URL for deep links + browser back/forward. Writes activeIndex
	// only (which this effect does not read), so no loop. A programmatic swipe
	// sets activeIndex before goto resolves, so the effect is a no-op then.
	let lastPathname = page.url.pathname;
	$effect(() => {
		const pathname = page.url.pathname;
		if (pathname !== lastPathname) {
			lastPathname = pathname;
			untrack(() => {
				const idx = getCurrentTabIndex(pathname);
				if (idx >= 0 && idx !== activeIndex) {
					activeIndex = idx;
				}
			});
		}
	});

	let isTransitioningOut = $state(false);

	const trackTranslateX = $derived(
		isTransitioningOut
			? '0px'
			: dragOffset === null
				? `-${activeIndex * STEP_PERCENT}%`
				: `calc(-${activeIndex * STEP_PERCENT}% + ${dragOffset}px)`
	);

	const trackStyle = $derived(
		dragOffset !== null && !isTransitioningOut
			? `transform: translateX(${trackTranslateX}); transition: none`
			: `transform: translateX(${trackTranslateX})`
	);

	/** 1:1 in the middle; 0.4x rubber-band past the first/last tab (no neighbour). */
	function follow(deltaX: number): number {
		const last = MOBILE_TABS.length - 1;
		if (activeIndex <= 0 && deltaX > 0) return deltaX * 0.4;
		if (activeIndex >= last && deltaX < 0) return deltaX * 0.4;
		return deltaX;
	}

	function swipeMove(deltaX: number): void {
		// During a back-swipe toward a deep page:
		// - If we have a cached snapshot, overlay the snapshot on section 0 and slide the track.
		// - Otherwise, do not slide the track and show the shared back chip overlay instead.
		if (deltaX > 0 && backSwipeShouldPopHistory(activeIndex - 1)) {
			if (deepPageSnapshot.hasSnapshot) {
				showDeepPreview = true;
				backChipReveal = null;
				dragOffset = follow(deltaX);
			} else {
				showDeepPreview = false;
				backChipReveal = Math.min(deltaX, window.innerWidth * 0.6);
				dragOffset = null;
			}
		} else {
			showDeepPreview = false;
			backChipReveal = null;
			dragOffset = follow(deltaX);
		}
		getScrollChromeStore().show();
	}
	function switchTo(index: number): void {
		activeIndex = index;
		getScrollChromeStore().show();
		navStore.navigateForward(MOBILE_TABS[index].href);
	}
	/**
	 * Back-swipe toward the previous tab. When the history entry behind this tab
	 * is a DEEP page (the tab was reached by a forward swipe from a thread /
	 * profile / bookmarks / ...), return to THAT page via history.back() instead
	 * of switching to the spatially-previous tab root - the spatial switch would
	 * push the root and strand the originating page between the two. Otherwise
	 * the normal spatial tab switch. Route-agnostic (backSwipeShouldPopHistory
	 * keys off the shared tab config), so it covers every deep page.
	 */
	function switchBackward(): void {
		getScrollChromeStore().show();

		const targetIndex = activeIndex - 1;
		const shouldPop = backSwipeShouldPopHistory(targetIndex);
		if (!shouldPop) {
			activeIndex = targetIndex;
		}
		navStore.navigateBackward(MOBILE_TABS[targetIndex].href);
	}
	function swipeEnd(deltaX: number, velocity: number, reversed: boolean): void {
		const last = MOBILE_TABS.length - 1;
		const wasDeepPreview = showDeepPreview || backChipReveal !== null;
		if (deltaX <= -SWIPE_COMMIT && activeIndex < last && !reversed) {
			switchTo(activeIndex + 1);
			dragOffset = null;
			showDeepPreview = false;
			backChipReveal = null;
		} else if (deltaX >= SWIPE_COMMIT && activeIndex > 0 && !reversed) {
			if (wasDeepPreview) {
				isTransitioningOut = true;
				setTimeout(() => {
					switchBackward();
				}, 300);
			} else {
				switchBackward();
				dragOffset = null;
				showDeepPreview = false;
				backChipReveal = null;
			}
		} else {
			dragOffset = null;
			showDeepPreview = false;
			backChipReveal = null;
		}
	}

	// `settled` = the local activeIndex matches the URL's tab, i.e. no swipe
	// transition in flight. Only then do we trust the page store's data for the
	// active tab (mid-transition page.data still belongs to the previous route).
	const settled = $derived(activeIndex === getCurrentTabIndex(page.url.pathname));

	// Active tab: its route's page-load data (reflects ?page). Other tabs: the
	// eager layout page-1 data. `??` because the page store types the active tab's
	// fields as possibly-undefined on other routes (OptionalUnion).
	const home = $derived(
		settled && activeIndex === 0
			? {
					discussions: page.data.discussions ?? data.home.discussions,
					page: page.data.page ?? data.home.page,
					totalPages: page.data.totalPages ?? data.home.totalPages,
					totalCount: page.data.totalCount ?? data.home.totalCount
				}
			: data.home
	);
	const activity = $derived(
		settled && activeIndex === 1
			? {
					activities: page.data.activities ?? data.activity.activities,
					page: page.data.page ?? data.activity.page,
					totalPages: page.data.totalPages ?? data.activity.totalPages,
					totalCount: page.data.totalCount ?? data.activity.totalCount,
					activityDraft: page.data.activityDraft ?? data.activity.activityDraft,
					mentionedUsers: page.data.mentionedUsers ?? data.activity.mentionedUsers
				}
			: data.activity
	);
	const messages = $derived(
		settled && activeIndex === 2
			? {
					conversations: page.data.conversations ?? data.messages.conversations,
					page: page.data.page ?? data.messages.page,
					totalPages: page.data.totalPages ?? data.messages.totalPages,
					totalCount: page.data.totalCount ?? data.messages.totalCount
				}
			: data.messages
	);

	// Home pagination inside the pager targets the standalone /discussions/pN route.
	const buildPageUrl: PageUrlBuilder = (p) => (p === 1 ? '/' : `/discussions/p${p}`);

	// Screen-height viewport under fixed-viewport: each panel is a full-height
	// .scroll-pane scroller (the height model GesturePageLayout uses). No
	// per-panel height measurement - the viewport is constant screen height.
	const viewportStyle = $derived(
		'touch-action: pan-y pinch-zoom; height: 100%; overflow: clip; position: relative'
	);
	// The viewport's width = one panel width, used to normalise dragOffset into a
	// fractional tab offset for the indicator.
	const measureViewportWidth: Action<HTMLElement> = (node) => {
		viewportWidth = node.clientWidth;
		const ro = new ResizeObserver(() => {
			viewportWidth = node.clientWidth;
		});
		ro.observe(node);
		return {
			destroy: () => {
				ro.disconnect();
			}
		};
	};
</script>

<div
	class="mobile-tab-pager-viewport"
	style={viewportStyle}
	use:detectSwipe={{ onMove: swipeMove, onEnd: swipeEnd }}
	use:measureViewportWidth
>
	<div
		class="flex w-[300%] items-start h-full transition-transform duration-200"
		style={trackStyle}
		bind:this={trackEl}
	>
		<section
			class="scroll-pane h-full w-1/3 shrink-0"
			data-tab-panel={MOBILE_TABS[0].labelKey}
			style="overflow-y: auto; overscroll-behavior-y: contain; -webkit-overflow-scrolling: touch; touch-action: pan-y pinch-zoom;"
			bind:this={section0El}
			onscroll={(e) => pageScrollStore.capture(MOBILE_TABS[0].href, e.currentTarget.scrollTop)}
		>
			<div class="gpl-card">
				<DiscussionsPanel
					discussions={home.discussions}
					currentPage={home.page}
					totalPages={home.totalPages}
					{t}
					{buildPageUrl}
					paginate={true}
				/>
			</div>
		</section>
		<section
			class="scroll-pane h-full w-1/3 shrink-0"
			data-tab-panel={MOBILE_TABS[1].labelKey}
			style="overflow-y: auto; overscroll-behavior-y: contain; -webkit-overflow-scrolling: touch; touch-action: pan-y pinch-zoom;"
			bind:this={section1El}
			onscroll={(e) => pageScrollStore.capture(MOBILE_TABS[1].href, e.currentTarget.scrollTop)}
		>
			<div class="gpl-card">
				<ActivityPanel
					activities={activity.activities}
					currentPage={activity.page}
					totalPages={activity.totalPages}
					activityDraft={activity.activityDraft}
					mentionedUsers={activity.mentionedUsers}
					{t}
					{user}
					paginate={true}
				/>
			</div>
		</section>
		<section
			class="scroll-pane h-full w-1/3 shrink-0"
			data-tab-panel={MOBILE_TABS[2].labelKey}
			style="overflow-y: auto; overscroll-behavior-y: contain; -webkit-overflow-scrolling: touch; touch-action: pan-y pinch-zoom;"
			bind:this={section2El}
			onscroll={(e) => pageScrollStore.capture(MOBILE_TABS[2].href, e.currentTarget.scrollTop)}
		>
			<div class="gpl-card">
				<MessagesPanel
					conversations={messages.conversations}
					currentPage={messages.page}
					totalPages={messages.totalPages}
					{t}
					paginate={true}
				/>
			</div>
		</section>
		{#if showDeepPreview && deepPageSnapshot.data}
			<!-- Real Svelte component rendering the cached thread DATA (not injected
			     HTML). Uses the same atoms (DiscussionMetadata, LexicalRenderer) as
			     the thread page, so scoped CSS applies correctly. Overlaid on
			     section 0 inside the track so it slides 1:1 with the gesture. -->
			<div
				data-deep-preview
				bind:this={deepPreviewEl}
				class="absolute left-0 z-10 w-1/3 overflow-y-auto scroll-pane"
				style="top: 0; height: 100%;"
			>
				<div class="gpl-card">
					{#if deepPageSnapshot.snippet}
						{@render deepPageSnapshot.snippet()}
					{/if}
				</div>
			</div>
		{/if}
	</div>
	{#if backChipReveal !== null}
		<div
			class="back-chip-overlay absolute inset-y-0 left-0 z-30 flex items-center justify-center pointer-events-none"
			class:transitioning={isTransitioningOut}
			style="width: {isTransitioningOut
				? '100%'
				: `${backChipReveal}px`}; opacity: {isTransitioningOut ? 0 : 1};"
		>
			<LoadingChip icon={mdiArrowLeft} scale={1} expanded={false} pulsing={false} dragging />
		</div>
	{/if}
</div>

<style>
	/* The back-to-deep-page overlay: covers from the left edge, growing with the
	   drag, hosting the shared LoadingChip back affordance. */
	.back-chip-overlay {
		background-color: var(--color-base-200);
	}
	.back-chip-overlay.transitioning {
		transition:
			width 300ms cubic-bezier(0.25, 0.8, 0.25, 1),
			opacity 300ms ease;
	}
</style>
