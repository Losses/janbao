<script lang="ts">
	/**
	 * ThreadPager - Renders a discussion thread as a REAL pager panel flanked by
	 * its live neighbours: `[discussion list | thread | Activity]`. A horizontal
	 * drag reveals the neighbour 1:1 (not a translated current page), and a
	 * committed release navigates - right swipe -> `/` (the list, whose scroll is
	 * remembered via the list-scroll store), left swipe -> `/activity`. Mobile
	 * only; desktop renders the thread directly.
	 *
	 * Same mechanics as MobileTabPager: 3 sections in a 300%-wide track, position
	 * driven by an inline `transform` (Tailwind v4 translate-x-* would compose,
	 * not override), `overflow-hidden` to clip the off-screen neighbours, and the
	 * viewport sized to the active (middle/thread) panel so a taller list can't
	 * stretch the page.
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import type { Action } from 'svelte/action';
	import { detectSwipe } from '$lib/actions/swipe';
	import { getMobilePagerStore } from '$lib/stores/mobile-pager.svelte';
	import DiscussionsPanel from '$lib/components/panels/DiscussionsPanel.svelte';
	import ActivityPanel from '$lib/components/panels/ActivityPanel.svelte';
	import type { DiscussionsTabData, PageUrlBuilder } from '$lib/types/tabs';
	import type { ActivityPageResult } from '$lib/server/db/dao/activities';
	import type { UserInfoSummary } from '$lib/types/api';
	import type { TranslationDict } from '$lib/types/translation';

	interface ThreadPagerProps {
		list: DiscussionsTabData;
		activity: ActivityPageResult;
		t: TranslationDict;
		user: UserInfoSummary | null;
		children: Snippet;
	}

	let { list, activity, t, user, children }: ThreadPagerProps = $props();

	const MOBILE_BREAKPOINT = '(max-width: 767px)';
	let isMobile = $state(false);
	onMount(() => {
		const mq = window.matchMedia(MOBILE_BREAKPOINT);
		const sync = () => (isMobile = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});

	const STEP_PERCENT = 100 / 3; // three panels
	const ACTIVE = 1; // the thread is the middle panel
	const SWIPE_COMMIT = 60; // px past which a release commits the switch
	const SNAP_MS = 200; // matches the track's transition-transform duration

	// dragOffset: a live px offset while a pointer is dragging (1:1, transition
	// none); null while at rest or snapping, in which case the track translates to
	// `snapIndex` and the CSS transition animates the snap - same pattern as
	// MobileTabPager, so release slides to completion instead of jumping.
	let dragOffset = $state<number | null>(null);
	let snapIndex = $state(ACTIVE);
	let navTimer: ReturnType<typeof setTimeout> | null = null;

	const trackStyle = $derived(
		dragOffset !== null
			? `transform: translateX(calc(-${ACTIVE * STEP_PERCENT}% + ${dragOffset}px)); transition: none`
			: `transform: translateX(-${snapIndex * STEP_PERCENT}%)`
	);

	// Both neighbours exist, so pure 1:1 (like a middle tab on the tab pager).
	function swipeMove(deltaX: number): void {
		if (navTimer) {
			clearTimeout(navTimer);
			navTimer = null;
		}
		dragOffset = deltaX;
	}
	function swipeEnd(deltaX: number): void {
		if (deltaX >= SWIPE_COMMIT) {
			snapIndex = 0; // reveal the list fully, then go
			navTimer = setTimeout(() => void goto('/'), SNAP_MS);
		} else if (deltaX <= -SWIPE_COMMIT) {
			snapIndex = 2; // reveal Activity fully, then go
			navTimer = setTimeout(() => void goto('/activity'), SNAP_MS);
		} else {
			snapIndex = ACTIVE; // cancel: snap back to the thread
		}
		dragOffset = null; // drop the inline transition:none -> CSS transition snaps
	}

	// Publish drag progress to the shared store so the top tab bar's indicator
	// tracks. Thread = Discussions (tab 0); left swipe toward Activity maps 0->1,
	// right swipe toward the list stays 0. While snapping, follow snapIndex.
	const pager = getMobilePagerStore();
	let viewportWidth = $state(0);
	$effect(() => {
		const progress =
			dragOffset !== null && viewportWidth
				? Math.max(0, Math.min(1, -dragOffset / viewportWidth))
				: snapIndex === 2
					? 1
					: 0;
		pager.set({ fractionalIndex: progress, dragging: dragOffset !== null, active: true });
	});
	onMount(() => {
		pager.set({ fractionalIndex: 0, dragging: false, active: true });
		return () => {
			if (navTimer) clearTimeout(navTimer);
			pager.set({ fractionalIndex: 0, dragging: false, active: false });
		};
	});
	const measureViewportWidth: Action<HTMLElement> = (node) => {
		const update = () => {
			viewportWidth = node.clientWidth;
		};
		update();
		const ro = new ResizeObserver(update);
		ro.observe(node);
		return { destroy: () => ro.disconnect() };
	};

	// Size the viewport to the active (thread) panel so a taller list can't
	// stretch the page and leave blank under a short thread.
	let threadHeight = $state(0);
	const viewportStyle = $derived(
		`touch-action: pan-y pinch-zoom${threadHeight ? `; height: ${threadHeight}px` : ''}`
	);
	const measureThread: Action<HTMLElement> = (node) => {
		const update = () => {
			threadHeight = node.offsetHeight;
		};
		update();
		const ro = new ResizeObserver(update);
		ro.observe(node);
		return { destroy: () => ro.disconnect() };
	};

	const buildPageUrl: PageUrlBuilder = (p) => (p === 1 ? '/' : `/discussions/p${p}`);
</script>

{#if isMobile}
	<div
		class="overflow-hidden"
		style={viewportStyle}
		use:detectSwipe={{ onMove: swipeMove, onEnd: swipeEnd }}
		use:measureViewportWidth
	>
		<div class="flex w-[300%] items-start transition-transform duration-200" style={trackStyle}>
			<section class="w-1/3 shrink-0 p-3">
				<DiscussionsPanel
					discussions={list.discussions}
					currentPage={list.page}
					totalPages={list.totalPages}
					{t}
					{buildPageUrl}
					paginate={false}
				/>
			</section>
			<section class="w-1/3 shrink-0 p-3" use:measureThread>
				{@render children()}
			</section>
			<section class="w-1/3 shrink-0 p-3">
				<ActivityPanel
					activities={activity.activities}
					currentPage={activity.page}
					totalPages={activity.totalPages}
					activityDraft={activity.activityDraft}
					mentionedUsers={activity.mentionedUsers}
					{t}
					{user}
					paginate={false}
				/>
			</section>
		</div>
	</div>
{:else}
	{@render children()}
{/if}
