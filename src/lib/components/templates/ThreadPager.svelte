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

	interface ThreadPagerProps {
		left?: Snippet;
		right?: Snippet;
		leftHref?: string;
		rightHref?: string;
		centerTab: number;
		rightTab?: number;
		children: Snippet;
	}

	let { left, right, leftHref, rightHref, centerTab, rightTab, children }: ThreadPagerProps =
		$props();

	const MOBILE_BREAKPOINT = '(max-width: 767px)';
	let isMobile = $state(false);

	// Viewport element ref + scroll tracking for neighbor vertical alignment.
	let viewportEl: HTMLElement | null = $state(null);
	let scrollY = $state(0);
	let viewportDocTop = $state(0); // viewport's fixed Y in the document (set once)

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

	// neighborOffset = how far the page is scrolled past the viewport's top.
	// Applied as translateY on neighbor panels so their Y=0 aligns with the
	// visible area top — matching the new page at scrollY=0 after navigation.
	const neighborOffset = $derived(Math.max(0, scrollY - viewportDocTop));

	const trackStyle = $derived(
		dragOffset !== null
			? `width: ${panelCount * 100}%; transform: translateX(calc(-${ACTIVE * STEP_PERCENT}% + ${dragOffset}px)); transition: none`
			: `width: ${panelCount * 100}%; transform: translateX(-${snapIndex * STEP_PERCENT}%)`
	);
	const sectionWidth = $derived(`${100 / panelCount}%`);
	const neighborStyle = $derived(
		`width: ${sectionWidth}; transform: translateY(${neighborOffset}px)`
	);
	const centerStyle = $derived(`width: ${sectionWidth}`);
	const viewportStyle = $derived(
		`touch-action: pan-y pinch-zoom; flex: 1 0 auto${threadHeight ? `; height: ${threadHeight}px` : ''}`
	);

	function swipeMove(deltaX: number): void {
		dragOffset = deltaX;
	}
	function cancelPendingNav(): void {
		pendingNav = null;
		snapIndex = ACTIVE;
	}
	function swipeEnd(deltaX: number): void {
		const leftIdx = left ? 0 : -1;
		const rightIdx = right ? panelCount - 1 : -1;
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
		console.log('[ThreadPager] onMount START');
		// Mobile detection
		const mq = window.matchMedia(MOBILE_BREAKPOINT);
		const sync = () => (isMobile = mq.matches);
		sync();
		mq.addEventListener('change', sync);

		// Pager store
		pager.set({ fractionalIndex: centerTab, dragging: false, active: true });

		// Scroll tracking
		const onScroll = () => {
			scrollY = window.scrollY;
		};
		window.addEventListener('scroll', onScroll, { passive: true });
		scrollY = window.scrollY;

		// After DOM renders ({#if isMobile}), read the viewport's position.
		const raf = requestAnimationFrame(() => {
			console.log('[ThreadPager] rAF fired', {
				viewportElExists: !!viewportEl,
				viewportElTop: viewportEl ? Math.round(viewportEl.getBoundingClientRect().top) : null,
				scrollY: Math.round(window.scrollY)
			});
			if (viewportEl) {
				viewportDocTop = viewportEl.getBoundingClientRect().top + window.scrollY;
				viewportWidth = viewportEl.clientWidth;
				console.log('[ThreadPager] set viewportDocTop', {
					viewportDocTop: Math.round(viewportDocTop),
					neighborOffset: Math.round(Math.max(0, scrollY - viewportDocTop))
				});
			}
		});

		return () => {
			mq.removeEventListener('change', sync);
			window.removeEventListener('scroll', onScroll);
			cancelAnimationFrame(raf);
			pendingNav = null;
			pager.set({ fractionalIndex: 0, dragging: false, active: false });
		};
	});

	// Re-measure viewport position on resize (header height might change).
	const measureViewport: Action<HTMLElement> = (node) => {
		viewportEl = node;
		const ro = new ResizeObserver(() => {
			viewportWidth = node.clientWidth;
			viewportDocTop = node.getBoundingClientRect().top + window.scrollY;
		});
		ro.observe(node);
		return { destroy: () => ro.disconnect() };
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
				<section class="shrink-0 p-3" style={neighborStyle}>
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
