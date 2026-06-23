<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getNavigationStore } from '$lib/stores/navigation.svelte';
	import { getPageScrollStore } from '$lib/stores/page-scroll.svelte';
	import { backHandler } from '$lib/stores/navigation.svelte';
	import { detectSwipe } from '$lib/actions/swipe';
	import type { Action } from 'svelte/action';

	interface Props {
		children: Snippet;
		left?: Snippet;
		leftHref?: string;
		fallbackRoute?: string;
	}

	interface PendingNav {
		href: string;
		back: boolean;
	}

	let { children, left, leftHref, fallbackRoute = '/' }: Props = $props();
	const navStore = getNavigationStore();
	const pageScrollStore = getPageScrollStore();

	const MOBILE_BREAKPOINT = '(max-width: 767px)';
	const getIsMobile = () => {
		if (typeof window === 'undefined') {
			return page.data.isMobile ?? false;
		}
		return window.matchMedia(MOBILE_BREAKPOINT).matches;
	};
	let isMobile = $state(getIsMobile());

	let leftEl = $state<HTMLElement | null>(null);
	const leftScrollTop = $derived(leftHref ? pageScrollStore.get(leftHref) : 0);

	let centerEl = $state<HTMLElement | null>(null);
	const currentScrollTop = $derived(page.url.pathname ? pageScrollStore.get(page.url.pathname) : 0);

	const shouldAnimateEnter = () => {
		if (!left || !leftHref) return false;
		if (navStore.direction !== 'forward') return false;
		if (navStore.activeStack.length < 2) return false;
		const prevPath = navStore.activeStack[navStore.activeStack.length - 2].pathname;
		return prevPath === leftHref;
	};

	const isEntering = shouldAnimateEnter();
	let dragOffset = $state<number | null>(null);
	// svelte-ignore state_referenced_locally
	let snapIndex = $state(isEntering ? 0 : left ? 1 : 0);
	const panelCount = $derived((left ? 1 : 0) + 1);
	const ACTIVE = $derived(left ? 1 : 0);
	const STEP_PERCENT = $derived(100 / panelCount);
	const SWIPE_COMMIT = 60;
	let viewportEl: HTMLElement | null = $state(null);

	let pendingNav = $state<PendingNav | null>(null);

	$effect(() => {
		if (leftEl && leftScrollTop > 0) {
			leftEl.scrollTop = leftScrollTop;
			const rafId = requestAnimationFrame(() => {
				if (leftEl) {
					leftEl.scrollTop = leftScrollTop;
				}
			});
			return () => cancelAnimationFrame(rafId);
		}
	});

	$effect(() => {
		if (centerEl && currentScrollTop > 0) {
			centerEl.scrollTop = currentScrollTop;
			const rafId = requestAnimationFrame(() => {
				if (centerEl) {
					centerEl.scrollTop = currentScrollTop;
				}
			});
			return () => cancelAnimationFrame(rafId);
		}
	});

	const trackStyle = $derived(
		!isMobile
			? 'width: 100%; transform: none; display: block;'
			: dragOffset !== null
				? `width: ${panelCount * 100}%; transform: translateX(calc(-${ACTIVE * STEP_PERCENT}% + ${dragOffset}px)); transition: none; display: flex; height: 100%;`
				: `width: ${panelCount * 100}%; transform: translateX(-${snapIndex * STEP_PERCENT}%); display: flex; height: 100%;`
	);

	const sectionWidth = $derived(`${100 / panelCount}%`);
	const leftStyle = $derived(
		!isMobile
			? 'display: none;'
			: `width: ${sectionWidth}; height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain; touch-action: pan-y pinch-zoom;`
	);
	const centerStyle = $derived(
		!isMobile
			? 'width: 100%; display: block;'
			: `width: ${sectionWidth}; height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain; touch-action: pan-y pinch-zoom;`
	);

	const viewportStyle = $derived(
		!isMobile
			? 'touch-action: auto; overflow: visible; height: auto; width: 100%; position: relative;'
			: 'touch-action: pan-y pinch-zoom; flex: 1 1 auto; height: 100%; position: relative; width: 100%; overflow: hidden;'
	);

	function onSwipeMove(deltaX: number) {
		if (deltaX > 0) {
			dragOffset = deltaX;
		}
	}

	function backLandsOn(targetPath: string): boolean {
		if (typeof navigation !== 'undefined') {
			const cur = navigation.currentEntry;
			if (cur && cur.index > 0) {
				const prev = navigation.entries()[cur.index - 1];
				if (prev && prev.url !== null) {
					try {
						return new URL(prev.url).pathname === targetPath;
					} catch {
						return false;
					}
				}
			}
		}
		return false;
	}

	function onSwipeEnd(deltaX: number) {
		const committed = deltaX >= SWIPE_COMMIT;
		if (committed) {
			const consumed = backHandler.dispatch();
			if (!consumed) {
				if (left && leftHref) {
					snapIndex = 0;
					const back = backLandsOn(leftHref) || navStore.activeStack.length > 1;
					pendingNav = { href: leftHref, back };
				} else {
					if (navStore.activeStack.length > 1) {
						history.back();
					} else {
						void goto(fallbackRoute, { replaceState: true });
					}
				}
			} else {
				snapIndex = ACTIVE;
			}
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

	onMount(() => {
		const mq = window.matchMedia(MOBILE_BREAKPOINT);
		const sync = () => {
			isMobile = mq.matches;
			if (isMobile) {
				document.documentElement.classList.add('fixed-viewport');
			} else {
				document.documentElement.classList.remove('fixed-viewport');
			}
		};
		sync();
		mq.addEventListener('change', sync);

		let enterRaf = 0;
		if (isEntering && isMobile) {
			enterRaf = requestAnimationFrame(() => {
				enterRaf = requestAnimationFrame(() => {
					snapIndex = ACTIVE;
				});
			});
		}

		return () => {
			mq.removeEventListener('change', sync);
			document.documentElement.classList.remove('fixed-viewport');
			if (enterRaf) cancelAnimationFrame(enterRaf);
		};
	});

	const measureViewport: Action<HTMLElement> = (node) => {
		viewportEl = node;
		const resetScroll = () => {
			if (node.scrollTop !== 0) node.scrollTop = 0;
			if (node.scrollLeft !== 0) node.scrollLeft = 0;
		};
		node.addEventListener('scroll', resetScroll, { passive: true });
		resetScroll();
		return {
			destroy() {
				node.removeEventListener('scroll', resetScroll);
			}
		};
	};
</script>

<div
	bind:this={viewportEl}
	class={isMobile ? 'overflow-hidden h-full w-full' : ''}
	style={viewportStyle}
	use:detectSwipe={{ onMove: onSwipeMove, onEnd: onSwipeEnd, disabled: () => !isMobile || !left }}
	use:measureViewport
>
	<div
		class={isMobile ? 'flex items-start transition-transform duration-200 h-full w-full' : ''}
		style={trackStyle}
		ontransitionend={onTrackTransitionEnd}
	>
		{#if left && isMobile}
			<section
				bind:this={leftEl}
				class="shrink-0 p-3 scroll-pane md:hidden"
				style={leftStyle}
				onscroll={(e) => {
					if (leftHref && e.currentTarget.scrollTop > 0) {
						pageScrollStore.capture(leftHref, e.currentTarget.scrollTop);
					}
				}}
			>
				{@render left()}
			</section>
		{/if}
		<section
			bind:this={centerEl}
			class="shrink-0 p-3 scroll-pane detail-scroll-pane h-full w-full"
			style={centerStyle}
		>
			{@render children()}
		</section>
	</div>
</div>
