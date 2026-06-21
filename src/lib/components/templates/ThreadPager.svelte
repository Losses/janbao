<script lang="ts">
	/**
	 * ThreadPager - Renders an inner page as a REAL pager panel flanked by its
	 * live neighbours. Mobile only; desktop renders children directly.
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import type { Action } from 'svelte/action';
	import { detectSwipe } from '$lib/actions/swipe';
	import { getMobilePagerStore } from '$lib/stores/mobile-pager.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';

	import { page } from '$app/state';

	interface ThreadPagerProps {
		left?: Snippet;
		right?: Snippet;
		leftHref?: string;
		rightHref?: string;
		centerTab: number;
		rightTab?: number;
		/** Scroll the left neighbour should preview at, so its reveal matches the
		 * position the committed navigation restores to. Pass the captured value when
		 * the destination restores scroll (the discussions list via list-scroll);
		 * leave 0 when it lands at the top (the messages list). */
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

	// Viewport element ref + scroll tracking for neighbor vertical alignment.
	let viewportEl: HTMLElement | null = $state(null);
	let scrollY = $state(0);

	const panelCount = $derived((left ? 1 : 0) + 1 + (right ? 1 : 0));
	const ACTIVE = $derived(left ? 1 : 0);
	const STEP_PERCENT = $derived(100 / panelCount);
	const SWIPE_COMMIT = 60;

	let dragOffset = $state<number | null>(null);
	// svelte-ignore state_referenced_locally
	let snapIndex = $state(ACTIVE);
	let pendingNav = $state<string | null>(null);
	let viewportWidth = $state(0);
	let threadHeight = $state(0);

	// neighborOffset tracks window.scrollY so a neighbour panel stays at a fixed
	// screen position while the window scrolls - this is what makes the horizontal
	// swipe-to-neighbour transition seamless and lets the committed swipe's
	// scrollTo(0,0) + translateY(0) land without a vertical jump. It MUST equal
	// scrollY, so auto-scroll (which moves window.scrollY) inflating the neighbour
	// transform is expected and harmless: neighbours are clipped off-screen and
	// self-heal on the committed swipe.
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
	// The left neighbour previews at leftPreviewScroll (the scroll the committed
	// navigation restores to), so the reveal matches the landing position and the
	// list does not jump on commit. NOT clamped: when the list was scrolled deeper
	// than the thread (capturedY > scrollY) the offset goes negative, which is
	// correct (it just shows the neighbour scrolled up) - clamping it broke that
	// case. The right neighbour commits to scroll 0, so it stays at neighborOffset.
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
			pendingNav = leftHref;
		} else if (deltaX <= -SWIPE_COMMIT && rightIdx >= 0 && rightHref) {
			snapIndex = rightIdx;
			pendingNav = rightHref;
		} else {
			snapIndex = ACTIVE;
		}
		dragOffset = null;
	}
	function onTrackTransitionEnd(event: TransitionEvent): void {
		if (event.target !== event.currentTarget) return;
		if (event.propertyName !== 'transform' || !pendingNav) return;
		const href = pendingNav;
		pendingNav = null;
		void goto(href);
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

		return () => {
			mq.removeEventListener('change', sync);
			window.removeEventListener('scroll', onScroll);
			cancelAnimationFrame(raf);
			if (scrollRaf) cancelAnimationFrame(scrollRaf);
			pendingNav = null;
			pager.set({ fractionalIndex: 0, dragging: false, active: false });
		};
	});

	// Re-measure viewport width on resize (header height might change). Also
	// guards the viewport's internal scroll at 0,0: overflow:hidden is still a
	// programmatic scroll container, so native hash scrolling or any stray
	// scrollIntoView could set a non-zero scrollTop here that the user cannot
	// reset - locking the page on the anchor with everything above clipped.
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
		class="overflow-hidden"
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
				<section class="shrink-0 p-3" style={leftNeighborStyle}>
					{@render left()}
				</section>
			{/if}
			<section class="shrink-0 p-3" style={centerStyle} use:measureThread>
				{@render children()}
			</section>
			{#if right}
				<section class="shrink-0 p-3" style={neighborStyle}>
					{@render right()}
				</section>
			{/if}
		</div>
	</div>
{:else}
	{@render children()}
{/if}
