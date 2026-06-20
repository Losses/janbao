<script lang="ts">
	/**
	 * ThreadPager - Renders an inner page (discussion/message thread) as a REAL
	 * pager panel flanked by its live neighbours. A horizontal drag reveals the
	 * neighbour 1:1 (not a translated current page), and a committed release
	 * slides to completion then navigates. Mobile only; desktop renders the
	 * thread directly.
	 *
	 * Generalized from the original discussion-only version: the caller provides
	 * optional `left` / `right` snippet panels + their hrefs + the tab indices
	 * for the indicator. Same mechanics as MobileTabPager.
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import type { Action } from 'svelte/action';
	import { detectSwipe } from '$lib/actions/swipe';
	import { getMobilePagerStore } from '$lib/stores/mobile-pager.svelte';

	interface ThreadPagerProps {
		left?: Snippet;
		right?: Snippet;
		leftHref?: string;
		rightHref?: string;
		/** Tab index of the center (thread's own tab), for the indicator. */
		centerTab: number;
		/** Tab index of the right panel (if any), for the indicator. */
		rightTab?: number;
		children: Snippet;
	}

	let { left, right, leftHref, rightHref, centerTab, rightTab, children }: ThreadPagerProps =
		$props();

	const MOBILE_BREAKPOINT = '(max-width: 767px)';
	let isMobile = $state(false);
	onMount(() => {
		const mq = window.matchMedia(MOBILE_BREAKPOINT);
		const sync = () => (isMobile = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});

	// Dynamic panel count + active index.
	const panelCount = $derived((left ? 1 : 0) + 1 + (right ? 1 : 0));
	const ACTIVE = $derived(left ? 1 : 0); // center is at index 1 (if left) or 0
	const STEP_PERCENT = $derived(100 / panelCount);
	const SWIPE_COMMIT = 60;
	const SNAP_MS = 200;

	let dragOffset = $state<number | null>(null);
	// svelte-ignore state_referenced_locally
	let snapIndex = $state(ACTIVE);
	let navTimer: ReturnType<typeof setTimeout> | null = null;

	const trackStyle = $derived(
		dragOffset !== null
			? `width: ${panelCount * 100}%; transform: translateX(calc(-${ACTIVE * STEP_PERCENT}% + ${dragOffset}px)); transition: none`
			: `width: ${panelCount * 100}%; transform: translateX(-${snapIndex * STEP_PERCENT}%)`
	);
	const sectionWidth = $derived(`${100 / panelCount}%`);

	function swipeMove(deltaX: number): void {
		if (navTimer) {
			clearTimeout(navTimer);
			navTimer = null;
		}
		dragOffset = deltaX;
	}
	/** Any new touch cancels a pending snap-navigate — a tap during the snap
	 * animation is the user's intent, not the swipe's. */
	function cancelPendingNav(): void {
		if (navTimer) {
			clearTimeout(navTimer);
			navTimer = null;
			snapIndex = ACTIVE;
		}
	}
	function swipeEnd(deltaX: number): void {
		const leftIdx = left ? 0 : -1;
		const rightIdx = right ? panelCount - 1 : -1;
		if (deltaX >= SWIPE_COMMIT && leftIdx >= 0 && leftHref) {
			snapIndex = leftIdx;
			navTimer = setTimeout(() => void goto(leftHref), SNAP_MS);
		} else if (deltaX <= -SWIPE_COMMIT && rightIdx >= 0 && rightHref) {
			snapIndex = rightIdx;
			navTimer = setTimeout(() => void goto(rightHref), SNAP_MS);
		} else {
			snapIndex = ACTIVE;
		}
		dragOffset = null;
	}

	// Publish drag progress to the shared store so the tab bar indicator tracks.
	const pager = getMobilePagerStore();
	let viewportWidth = $state(0);
	$effect(() => {
		let progress: number;
		if (dragOffset !== null && viewportWidth) {
			const dragProgress = Math.max(0, Math.min(1, -dragOffset / viewportWidth));
			progress =
				rightTab !== undefined ? centerTab + dragProgress * (rightTab - centerTab) : centerTab;
		} else {
			// At rest or snapping: follow snapIndex.
			const rightPanelIdx = right ? panelCount - 1 : -1;
			progress = snapIndex === rightPanelIdx && rightTab !== undefined ? rightTab : centerTab;
		}
		pager.set({ fractionalIndex: progress, dragging: dragOffset !== null, active: true });
	});
	onMount(() => {
		pager.set({ fractionalIndex: centerTab, dragging: false, active: true });
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

	let threadHeight = $state(0);
	const viewportStyle = $derived(
		`touch-action: pan-y pinch-zoom; flex: 1 0 auto${threadHeight ? `; height: ${threadHeight}px` : ''}`
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
</script>

{#if isMobile}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="overflow-hidden"
		style={viewportStyle}
		onpointerdown={cancelPendingNav}
		use:detectSwipe={{ onMove: swipeMove, onEnd: swipeEnd }}
		use:measureViewportWidth
	>
		<div class="flex items-start transition-transform duration-200" style={trackStyle}>
			{#if left}
				<section class="shrink-0 p-3" style={`width: ${sectionWidth}`}>
					{@render left()}
				</section>
			{/if}
			<section class="shrink-0 p-3" style={`width: ${sectionWidth}`} use:measureThread>
				{@render children()}
			</section>
			{#if right}
				<section class="shrink-0 p-3" style={`width: ${sectionWidth}`}>
					{@render right()}
				</section>
			{/if}
		</div>
	</div>
{:else}
	{@render children()}
{/if}
