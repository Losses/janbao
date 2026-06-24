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
	import { consumeEnterFromList, backLandsOnList } from '$lib/stores/thread-nav.svelte';
	import { page } from '$app/state';

	interface PendingNav {
		href: string;
		/** Pop the history entry (history.back) instead of pushing a goto - true
		 * for a back-to-list swipe when the thread was reached from the list. */
		back: boolean;
	}

	interface ThreadPagerProps {
		left?: Snippet;
		right?: Snippet;
		leftHref?: string;
		rightHref?: string;
		centerTab: number;
		rightTab?: number;
		listScrollTop?: number;
		detailScrollTop?: number;
		children: Snippet;
	}

	let {
		left,
		right,
		leftHref,
		rightHref,
		centerTab,
		rightTab,
		listScrollTop = $bindable(0),
		detailScrollTop = $bindable(0),
		children
	}: ThreadPagerProps = $props();

	const MOBILE_BREAKPOINT = '(max-width: 767px)';
	const getIsMobile = () => {
		if (typeof window === 'undefined') {
			return page.data.isMobile ?? false;
		}
		return window.matchMedia(MOBILE_BREAKPOINT).matches;
	};
	let isMobile = $state(getIsMobile());

	// Viewport element ref + scroll tracking for neighbor vertical alignment.
	let viewportEl: HTMLElement | null = $state(null);
	let listEl = $state<HTMLElement | null>(null);
	let detailEl = $state<HTMLElement | null>(null);

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

	let keyboardOffset = $state(0);

	const trackStyle = $derived(
		!isMobile
			? 'width: 100%; transform: none; display: block;'
			: dragOffset !== null
				? `width: ${panelCount * 100}%; transform: translateX(calc(-${ACTIVE * STEP_PERCENT}% + ${dragOffset}px)); transition: none; display: flex; height: 100%;`
				: `width: ${panelCount * 100}%; transform: translateX(-${snapIndex * STEP_PERCENT}%); display: flex; height: 100%;`
	);
	const sectionWidth = $derived(`${100 / panelCount}%`);
	const leftNeighborStyle = $derived(
		!isMobile
			? 'display: none;'
			: `width: ${sectionWidth}; height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain; touch-action: pan-y pinch-zoom;`
	);
	const centerStyle = $derived(
		!isMobile
			? 'width: 100%; display: block;'
			: `width: ${sectionWidth}; height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain; touch-action: pan-y pinch-zoom;`
	);
	const neighborStyle = $derived(
		!isMobile
			? 'display: none;'
			: `width: ${sectionWidth}; height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain; touch-action: pan-y pinch-zoom;`
	);

	const viewportStyle = $derived(
		!isMobile
			? 'touch-action: auto; overflow: visible; height: auto; width: 100%; position: relative;'
			: `touch-action: pan-y pinch-zoom; flex: 1 1 auto; height: calc(100% - ${keyboardOffset}px); position: relative; width: 100%;`
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
			// Pop the history entry when the real back destination is the list
			// (navigation.entries, with an arrival-origin fallback), so swiping
			// back does not stack duplicate `/` entries. Falls back to a pushed
			// goto for a deep-linked / non-list-entered thread.
			pendingNav = { href: leftHref, back: backLandsOnList() };
		} else if (deltaX <= -SWIPE_COMMIT && rightIdx >= 0 && rightHref) {
			snapIndex = rightIdx;
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
		if (!isMobile) return;
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

	// Synchronous Svelte 5 reactive effects to restore scrollTop upon mounting elements,
	// with a requestAnimationFrame fallback to handle browser layout settling.
	$effect(() => {
		if (listEl && listScrollTop > 0) {
			listEl.scrollTop = listScrollTop;
			const rafId = requestAnimationFrame(() => {
				if (listEl) {
					listEl.scrollTop = listScrollTop;
				}
			});
			return () => cancelAnimationFrame(rafId);
		}
	});

	$effect(() => {
		if (detailEl && detailScrollTop > 0) {
			detailEl.scrollTop = detailScrollTop;
			const rafId = requestAnimationFrame(() => {
				if (detailEl) detailEl.scrollTop = detailScrollTop;
			});
			return () => cancelAnimationFrame(rafId);
		}
	});

	interface BoundaryLockParams {
		disabled: boolean;
	}

	// Svelte Action for legacy iOS 15/WebView scroll boundary locking to prevent body overscroll.
	// Uses programmatically added non-passive listeners to allow e.preventDefault().
	const boundaryLock: Action<HTMLElement, BoundaryLockParams> = (node, initial) => {
		let disabled = initial.disabled;
		let startTouchY = 0;

		const handleStart = (e: TouchEvent) => {
			if (disabled) return;
			startTouchY = e.touches[0]?.clientY ?? 0;
		};

		const handleMove = (e: TouchEvent) => {
			if (disabled) return;
			const currentY = e.touches[0]?.clientY ?? 0;
			const direction = currentY - startTouchY;
			const scrollTop = node.scrollTop;
			const scrollHeight = node.scrollHeight;
			const clientHeight = node.clientHeight;

			if (scrollTop <= 0 && direction > 0) {
				if (e.cancelable) e.preventDefault();
			} else if (scrollTop + clientHeight >= scrollHeight && direction < 0) {
				if (e.cancelable) e.preventDefault();
			}
		};

		node.addEventListener('touchstart', handleStart, { passive: true });
		node.addEventListener('touchmove', handleMove, { passive: false });

		return {
			update(next) {
				disabled = next.disabled;
			},
			destroy() {
				node.removeEventListener('touchstart', handleStart);
				node.removeEventListener('touchmove', handleMove);
			}
		};
	};

	onMount(() => {
		// Mobile detection
		const mq = window.matchMedia(MOBILE_BREAKPOINT);
		const sync = () => {
			isMobile = mq.matches;
			if (isMobile) {
				document.documentElement.classList.add('fixed-viewport');
				// Reset any parent element's scroll that might have been changed by browser's native anchor scrolling
				// before fixed-viewport locked the scroll.
				window.scrollTo(0, 0);
				let parent = viewportEl?.parentElement;
				while (parent) {
					if (parent.scrollTop !== 0) parent.scrollTop = 0;
					if (parent.scrollLeft !== 0) parent.scrollLeft = 0;
					parent = parent.parentElement;
				}
			} else {
				document.documentElement.classList.remove('fixed-viewport');
			}
		};
		sync();
		mq.addEventListener('change', sync);

		// Intercept scroll events globally (in capture phase) to prevent the browser
		// from natively scrolling parent layout containers (like AppShell .min-h-screen)
		// when targeting a hash anchor on mount.
		const forceZeroScroll = (e: Event) => {
			if (!isMobile) return;
			const target = e.target as HTMLElement | null;
			if (!target) return;
			if (target === document || target === (window as unknown as HTMLElement)) {
				window.scrollTo(0, 0);
			} else if (target.classList && !target.classList.contains('scroll-pane')) {
				if (target.scrollTop !== 0) target.scrollTop = 0;
				if (target.scrollLeft !== 0) target.scrollLeft = 0;
			}
		};
		window.addEventListener('scroll', forceZeroScroll, true);

		// Pager store
		if (isMobile) {
			pager.set({ fractionalIndex: centerTab, dragging: false, active: true });
		}

		// After DOM renders, read the viewport's width for the pager indicator.
		const raf = requestAnimationFrame(() => {
			if (viewportEl) {
				viewportWidth = viewportEl.clientWidth;
			}
		});

		// Visual Viewport Resize listener to handle software keyboard on iOS Safari
		const handleViewportResize = () => {
			if (!window.visualViewport) return;
			const offset = window.innerHeight - window.visualViewport.height;
			keyboardOffset = Math.max(0, offset);
		};

		if (window.visualViewport) {
			window.visualViewport.addEventListener('resize', handleViewportResize);
			window.visualViewport.addEventListener('scroll', handleViewportResize);
			handleViewportResize();
		}

		// Forward list→thread push slide-in: snapIndex started at 0 (list) so the
		// first frame shows the list; this rAF flips it to ACTIVE on the next
		// frame, and the track's transition-transform plays the slide. Scheduled
		// after a frame (not sync) so the snapIndex=0 state actually paints and the
		// transition has a start value to animate from.
		let enterRaf = 0;
		if (animateEnter && isMobile) {
			enterRaf = requestAnimationFrame(() => {
				snapIndex = ACTIVE;
			});
		}

		return () => {
			mq.removeEventListener('change', sync);
			window.removeEventListener('scroll', forceZeroScroll, true);
			document.documentElement.classList.remove('fixed-viewport');
			cancelAnimationFrame(raf);
			if (enterRaf) cancelAnimationFrame(enterRaf);
			if (window.visualViewport) {
				window.visualViewport.removeEventListener('resize', handleViewportResize);
				window.visualViewport.removeEventListener('scroll', handleViewportResize);
			}
			pendingNav = null;
			pager.set({ fractionalIndex: 0, dragging: false, active: false });
		};
	});

	// Re-measure viewport width on resize
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
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={viewportEl}
	class={isMobile ? 'overflow-hidden' : ''}
	style={viewportStyle}
	onpointerdown={isMobile ? cancelPendingNav : undefined}
	use:detectSwipe={{ onMove: swipeMove, onEnd: swipeEnd, disabled: () => !isMobile }}
	use:measureViewport
>
	<div
		class={isMobile ? 'flex items-start transition-transform duration-200' : ''}
		style={trackStyle}
		ontransitionend={onTrackTransitionEnd}
	>
		{#if left && isMobile}
			<section
				bind:this={listEl}
				class="shrink-0 p-3 scroll-pane md:hidden"
				style={leftNeighborStyle}
				onscroll={(e) => {
					if (e.currentTarget.scrollTop > 0) {
						listScrollTop = e.currentTarget.scrollTop;
					}
				}}
				use:boundaryLock={{ disabled: false }}
			>
				{@render left()}
			</section>
		{/if}
		<section
			bind:this={detailEl}
			class="shrink-0 p-3 scroll-pane detail-scroll-pane"
			style={centerStyle}
			onscroll={isMobile ? (e) => (detailScrollTop = e.currentTarget.scrollTop) : undefined}
			use:boundaryLock={{ disabled: !isMobile }}
		>
			{@render children()}
		</section>
		{#if right && isMobile}
			<section
				class="shrink-0 p-3 scroll-pane md:hidden"
				style={neighborStyle}
				use:boundaryLock={{ disabled: false }}
			>
				{@render right()}
			</section>
		{/if}
	</div>
</div>
