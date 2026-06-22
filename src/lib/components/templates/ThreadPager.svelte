<script lang="ts">
	/**
	 * ThreadPager - renders a thread (discussion or conversation) as the CENTER
	 * panel of a horizontal pager flanked by its live neighbours: a LEFT list
	 * preview (the discussions list / message inbox) and an optional RIGHT
	 * Activity feed. Mobile only; the page renders it only on the mobile branch
	 * (desktop inlines the content into DualColumnLayout).
	 *
	 * Lives inside an OverlayLayer over the persistent MobileTabPager (see
	 * `(tabs)/+layout.svelte`). The left neighbour is a preview rendered from the
	 * (tabs) layout data; it is aligned (translateY(neighborOffset -
	 * leftPreviewScroll)) so that DURING a back-swipe the revealed preview matches
	 * the scroll position the committed navigation restores to - no y-jump
	 * mid-gesture. On commit the overlay unmounts and the real persistent pager
	 * (already at the restored scroll, set synchronously by the (tabs) layout's
	 * beforeNavigate) is revealed. A forward list→thread navigation plays a push
	 * slide-in via the enterFromList signal.
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import type { Action } from 'svelte/action';
	import { detectSwipe } from '$lib/actions/swipe';
	import { getMobilePagerStore } from '$lib/stores/mobile-pager.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';
	import { consumeEnterFromList, previousEntryIs } from '$lib/stores/thread-nav.svelte';

	import { page } from '$app/state';

	interface PendingNav {
		href: string;
		/** Pop the history entry (history.back) instead of pushing a goto - true
		 * for a back-to-list swipe when the prior entry is the list route. */
		back: boolean;
	}

	interface ThreadPagerProps {
		left?: Snippet;
		right?: Snippet;
		leftHref?: string;
		rightHref?: string;
		centerTab: number;
		rightTab?: number;
		/** Scroll the left neighbour should preview at (the captured list scroll),
		 * so its reveal during a back-swipe matches the position the committed
		 * navigation restores to. */
		leftPreviewScroll?: number;
		children: Snippet;
	}

	let {
		left,
		right,
		leftHref,
		rightHref,
		centerTab,
		rightTab,
		leftPreviewScroll = 0,
		children
	}: ThreadPagerProps = $props();

	const MOBILE_BREAKPOINT = '(max-width: 767px)';
	let isMobile = $state(page.data.isMobile ?? false);

	// Viewport element ref + scroll tracking for neighbour vertical alignment.
	let viewportEl: HTMLElement | null = $state(null);
	let scrollY = $state(0);

	const panelCount = $derived((left ? 1 : 0) + 1 + (right ? 1 : 0));
	const ACTIVE = $derived(left ? 1 : 0);
	const STEP_PERCENT = $derived(100 / panelCount);
	const SWIPE_COMMIT = 60;

	let dragOffset = $state<number | null>(null);
	// A forward list→thread navigation (see root +layout.svelte) plays a push
	// slide-in: start on the left (list) neighbour and animate to the thread.
	// Consumed once at init (module flag, reset on read); false on SSR / reload /
	// non-list entry, so snapIndex defaults to ACTIVE (no animation) then.
	const animateEnter = consumeEnterFromList();
	// svelte-ignore state_referenced_locally
	let snapIndex = $state(animateEnter ? 0 : ACTIVE);
	let pendingNav = $state<PendingNav | null>(null);
	let viewportWidth = $state(0);
	let threadHeight = $state(0);

	// neighborOffset tracks window.scrollY so a neighbour panel stays at a fixed
	// screen position while the window scrolls - this is what makes the horizontal
	// swipe-to-neighbour transition seamless and lets the committed swipe land
	// without a vertical jump. It MUST equal scrollY.
	const neighborOffset = $derived(scrollY);

	const trackStyle = $derived(
		dragOffset !== null
			? `width: ${panelCount * 100}%; transform: translateX(calc(-${ACTIVE * STEP_PERCENT}% + ${dragOffset}px)); transition: none`
			: `width: ${panelCount * 100}%; transform: translateX(-${snapIndex * STEP_PERCENT}%)`
	);
	const sectionWidth = $derived(`${100 / panelCount}%`);
	const neighborStyle = $derived(
		`width: ${sectionWidth}; transform: translateY(${neighborOffset}px)`
	);
	// The left neighbour previews at leftPreviewScroll (the captured list scroll),
	// so the reveal matches the landing position and the list does not jump on
	// commit. NOT clamped: when the list was scrolled deeper than the thread
	// (capturedY > scrollY) the offset goes negative, which is correct (it just
	// shows the neighbour scrolled up) - clamping it broke that case. The right
	// neighbour commits to scroll 0, so it stays at neighborOffset.
	const leftNeighborStyle = $derived(
		`width: ${sectionWidth}; transform: translateY(${neighborOffset - leftPreviewScroll}px)`
	);
	const centerStyle = $derived(`width: ${sectionWidth}`);
	const viewportStyle = $derived(
		`touch-action: pan-y pinch-zoom; flex: 1 0 auto${threadHeight ? `; height: ${threadHeight}px` : ''}`
	);

	function swipeMove(deltaX: number): void {
		dragOffset = deltaX;
		getScrollChromeStore().show();
	}
	function cancelPendingNav(): void {
		pendingNav = null;
		snapIndex = ACTIVE;
	}
	function swipeEnd(deltaX: number): void {
		const leftIdx = left ? 0 : -1;
		const rightIdx = right ? panelCount - 1 : -1;
		const committed =
			(deltaX >= SWIPE_COMMIT && leftIdx >= 0 && leftHref) ||
			(deltaX <= -SWIPE_COMMIT && rightIdx >= 0 && rightHref);
		if (committed) {
			getScrollChromeStore().show();
		}
		if (deltaX >= SWIPE_COMMIT && leftIdx >= 0 && leftHref) {
			snapIndex = leftIdx;
			// Pop the history entry when the real back destination is the list, so
			// swiping back does not stack duplicate entries. Falls back to a pushed
			// goto for a deep-linked / non-list-entered thread. The list scroll
			// itself is restored synchronously by the (tabs) layout's beforeNavigate
			// when the route actually changes (the preview masks the alignment until
			// then via leftPreviewScroll).
			pendingNav = { href: leftHref, back: leftHref ? previousEntryIs(leftHref) : false };
		} else if (deltaX <= -SWIPE_COMMIT && rightIdx >= 0 && rightHref) {
			snapIndex = rightIdx;
			if (typeof window !== 'undefined') window.scrollTo(0, 0);
			pendingNav = { href: rightHref, back: false };
		} else {
			snapIndex = ACTIVE;
		}
		dragOffset = null;
	}
	function onTrackTransitionEnd(event: TransitionEvent): void {
		if (event.target !== event.currentTarget) return;
		if (event.propertyName !== 'transform' || !pendingNav) return;
		const nav = pendingNav;
		pendingNav = null;
		if (nav.back) {
			history.back();
		} else {
			void goto(nav.href);
		}
	}

	const pager = getMobilePagerStore();
	$effect(() => {
		let progress: number;
		if (dragOffset !== null && viewportWidth) {
			const dragProgress = Math.max(0, Math.min(1, -dragOffset / viewportWidth));
			progress =
				rightTab !== undefined ? centerTab + dragProgress * (rightTab - centerTab) : centerTab;
		} else {
			const rightPanelIdx = right ? panelCount - 1 : -1;
			progress = snapIndex === rightPanelIdx && rightTab !== undefined ? rightTab : centerTab;
		}
		pager.set({ fractionalIndex: progress, dragging: dragOffset !== null, active: true });
	});

	onMount(() => {
		// Mobile detection
		const mq = window.matchMedia(MOBILE_BREAKPOINT);
		const sync = () => (isMobile = mq.matches);
		sync();
		mq.addEventListener('change', sync);

		// Pager store
		pager.set({ fractionalIndex: centerTab, dragging: false, active: true });

		// Scroll tracking for neighbour alignment. rAF-throttled (matches
		// MobileTabPager) so a smooth auto-scroll does not rewrite neighborOffset
		// on every frame. Clamped >= 0 to ignore negative scrollY from overscroll.
		let scrollRaf = 0;
		const onScroll = () => {
			if (scrollRaf) return;
			scrollRaf = requestAnimationFrame(() => {
				scrollRaf = 0;
				scrollY = Math.max(0, window.scrollY);
			});
		};
		window.addEventListener('scroll', onScroll, { passive: true });
		scrollY = Math.max(0, window.scrollY);

		// After DOM renders ({#if isMobile}), read the viewport's width for the
		// pager indicator.
		const raf = requestAnimationFrame(() => {
			if (viewportEl) {
				viewportWidth = viewportEl.clientWidth;
			}
		});

		// Forward list→thread push slide-in: snapIndex started at 0 (list) so the
		// first frame shows the list; this rAF flips it to ACTIVE on the next
		// frame, and the track's transition-transform plays the slide. Scheduled
		// after a frame (not sync) so the snapIndex=0 state actually paints and the
		// transition has a start value to animate from.
		let enterRaf = 0;
		if (animateEnter) {
			enterRaf = requestAnimationFrame(() => {
				snapIndex = ACTIVE;
			});
		}

		return () => {
			mq.removeEventListener('change', sync);
			window.removeEventListener('scroll', onScroll);
			cancelAnimationFrame(raf);
			if (enterRaf) cancelAnimationFrame(enterRaf);
			if (scrollRaf) cancelAnimationFrame(scrollRaf);
			pendingNav = null;
			pager.set({ fractionalIndex: 0, dragging: false, active: false });
		};
	});

	// Re-measure viewport width on resize. Also guards the viewport's internal
	// scroll at 0,0: overflow:hidden is still a programmatic scroll container, so
	// native hash scrolling or any stray scrollIntoView could set a non-zero
	// scrollTop here that the user cannot reset - locking the page on the anchor.
	const measureViewport: Action<HTMLElement> = (node) => {
		viewportEl = node;
		const resetScroll = () => {
			if (node.scrollTop !== 0) node.scrollTop = 0;
			if (node.scrollLeft !== 0) node.scrollLeft = 0;
		};
		node.addEventListener('scroll', resetScroll, { passive: true });
		resetScroll();
		const ro = new ResizeObserver(() => {
			viewportWidth = node.clientWidth;
		});
		ro.observe(node);
		return {
			destroy() {
				node.removeEventListener('scroll', resetScroll);
				ro.disconnect();
			}
		};
	};

	const measureThread: Action<HTMLElement> = (node) => {
		const update = () => {
			threadHeight = node.offsetHeight;
		};
		update();
		const ro = new ResizeObserver(update);
		ro.observe(node);
		return { destroy: () => ro.disconnect() };
	};
</script>

{#if isMobile}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={viewportEl}
		class="overflow-hidden bg-base-100"
		style={viewportStyle}
		onpointerdown={cancelPendingNav}
		use:detectSwipe={{ onMove: swipeMove, onEnd: swipeEnd }}
		use:measureViewport
	>
		<div
			class="flex items-start transition-transform duration-200"
			style={trackStyle}
			ontransitionend={onTrackTransitionEnd}
		>
			{#if left}
				<section class="shrink-0 p-3 bg-base-100" style={leftNeighborStyle}>
					{@render left()}
				</section>
			{/if}
			<section class="shrink-0 p-3 bg-base-100" style={centerStyle} use:measureThread>
				{@render children()}
			</section>
			{#if right}
				<section class="shrink-0 p-3 bg-base-100" style={neighborStyle}>
					{@render right()}
				</section>
			{/if}
		</div>
	</div>
{:else}
	{@render children()}
{/if}
