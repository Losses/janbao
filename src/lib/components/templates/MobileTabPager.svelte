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
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { Action } from 'svelte/action';
	import { detectSwipe } from '$lib/actions/swipe';
	import { getMobilePagerStore } from '$lib/stores/mobile-pager.svelte';
	import { MOBILE_TABS, getCurrentTabIndex } from '$lib/utils/mobile-tabs';
	import DiscussionsPanel from '$lib/components/panels/DiscussionsPanel.svelte';
	import ActivityPanel from '$lib/components/panels/ActivityPanel.svelte';
	import MessagesPanel from '$lib/components/panels/MessagesPanel.svelte';
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

	// Publish drag progress to the shared store so MobileTabBar's indicator
	// tracks the finger. fractionalIndex = active tab + fractional drag offset
	// (in panel widths); dragging drops the bar's CSS transition for 1:1 follow.
	const pager = getMobilePagerStore();
	let viewportWidth = $state(0);
	$effect(() => {
		pager.set({
			fractionalIndex: activeIndex - (dragOffset ?? 0) / (viewportWidth || 1),
			dragging: dragOffset !== null,
			active: true
		});
	});
	onMount(() => {
		// Mark the pager as the driver; the tab bar falls back to the URL until then.
		pager.set({ fractionalIndex: activeIndex, dragging: false, active: true });
		return () => pager.set({ fractionalIndex: 0, dragging: false, active: false });
	});

	// Sync from the URL for deep links + browser back/forward. Writes activeIndex
	// only (which this effect does not read), so no loop. A programmatic swipe
	// sets activeIndex before goto resolves, so the effect is a no-op then.
	$effect(() => {
		const idx = getCurrentTabIndex(page.url.pathname);
		if (idx >= 0 && idx !== activeIndex) activeIndex = idx;
	});

	const trackStyle = $derived(
		dragOffset === null
			? `transform: translateX(-${activeIndex * STEP_PERCENT}%)`
			: `transform: translateX(calc(-${activeIndex * STEP_PERCENT}% + ${dragOffset}px)); transition: none`
	);

	/** 1:1 in the middle; 0.4x rubber-band past the first/last tab (no neighbour). */
	function follow(deltaX: number): number {
		const last = MOBILE_TABS.length - 1;
		if (activeIndex <= 0 && deltaX > 0) return deltaX * 0.4;
		if (activeIndex >= last && deltaX < 0) return deltaX * 0.4;
		return deltaX;
	}
	function swipeMove(deltaX: number): void {
		dragOffset = follow(deltaX);
	}
	function switchTo(index: number): void {
		activeIndex = index;
		void goto(MOBILE_TABS[index].href);
	}
	function swipeEnd(deltaX: number): void {
		const last = MOBILE_TABS.length - 1;
		if (deltaX <= -SWIPE_COMMIT && activeIndex < last) switchTo(activeIndex + 1);
		else if (deltaX >= SWIPE_COMMIT && activeIndex > 0) switchTo(activeIndex - 1);
		dragOffset = null;
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

	// Size the viewport to the ACTIVE panel. A flex track would otherwise stretch
	// every section to the tallest panel (Activity, with its composer), leaving a
	// large blank gap under shorter tabs. `items-start` keeps each section at its
	// natural height; each reports it via ResizeObserver and the viewport follows
	// the active one (height changes instantly - no transition, to avoid
	// animating the surrounding content container on every tab switch).
	let panelHeights = $state<number[]>([0, 0, 0]);
	const viewportHeight = $derived(panelHeights[activeIndex]);
	const viewportStyle = $derived(
		`touch-action: pan-y pinch-zoom; min-height: 100%${viewportHeight ? `; height: ${viewportHeight}px` : ''}`
	);
	const measureTab: Action<HTMLElement, number> = (node, index) => {
		const update = () => {
			panelHeights[index] = node.offsetHeight;
		};
		update();
		const ro = new ResizeObserver(update);
		ro.observe(node);
		return { destroy: () => ro.disconnect() };
	};
	// The viewport's width = one panel width, used to normalise dragOffset into a
	// fractional tab offset for the indicator.
	const measureViewportWidth: Action<HTMLElement> = (node) => {
		const update = () => {
			viewportWidth = node.clientWidth;
		};
		update();
		const ro = new ResizeObserver(update);
		ro.observe(node);
		return { destroy: () => ro.disconnect() };
	};
</script>

<div
	class="overflow-hidden"
	style={viewportStyle}
	use:detectSwipe={{ onMove: swipeMove, onEnd: swipeEnd }}
	use:measureViewportWidth
>
	<div class="flex w-[300%] items-start transition-transform duration-200" style={trackStyle}>
		<section class="w-1/3 shrink-0 p-3" use:measureTab={0}>
			<DiscussionsPanel
				discussions={home.discussions}
				currentPage={home.page}
				totalPages={home.totalPages}
				{t}
				{buildPageUrl}
				paginate={activeIndex === 0}
			/>
		</section>
		<section class="w-1/3 shrink-0 p-3" use:measureTab={1}>
			<ActivityPanel
				activities={activity.activities}
				currentPage={activity.page}
				totalPages={activity.totalPages}
				activityDraft={activity.activityDraft}
				mentionedUsers={activity.mentionedUsers}
				{t}
				{user}
				paginate={activeIndex === 1}
			/>
		</section>
		<section class="w-1/3 shrink-0 p-3" use:measureTab={2}>
			<MessagesPanel
				conversations={messages.conversations}
				currentPage={messages.page}
				totalPages={messages.totalPages}
				{t}
				paginate={activeIndex === 2}
			/>
		</section>
	</div>
</div>
