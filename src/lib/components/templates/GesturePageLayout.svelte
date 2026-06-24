<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { goto, preloadData } from '$app/navigation';
	import { page } from '$app/state';
	import { getNavigationStore } from '$lib/stores/navigation.svelte';
	import { getPageScrollStore } from '$lib/stores/page-scroll.svelte';
	import { backHandler } from '$lib/stores/navigation.svelte';
	import { detectSwipe } from '$lib/actions/swipe';
	import type { Action } from 'svelte/action';
	import { getListCacheStore } from '$lib/stores/list-cache.svelte';
	import DiscussionsPanel from '$lib/components/panels/DiscussionsPanel.svelte';
	import ActivityPanel from '$lib/components/panels/ActivityPanel.svelte';
	import MessagesPanel from '$lib/components/panels/MessagesPanel.svelte';
	import type { ConversationListItem } from '$lib/types/api';
	import Icon from '$lib/components/atoms/Icon.svelte';
	import { MOBILE_TABS, isPagerRoute } from '$lib/utils/mobile-tabs';
	import { getMobilePagerStore } from '$lib/stores/mobile-pager.svelte';

	interface Props {
		children: Snippet;
		left?: Snippet;
		leftHref?: string;
		right?: Snippet;
		rightHref?: string;
		fallbackRoute?: string;
		centerTab?: number;
		rightTab?: number;
	}

	interface PendingNav {
		href: string;
		back: boolean;
		replaceState?: boolean;
	}

	let {
		children,
		left,
		leftHref,
		right,
		rightHref,
		fallbackRoute = '/',
		centerTab,
		rightTab
	}: Props = $props();

	const navStore = getNavigationStore();
	const pageScrollStore = getPageScrollStore();
	const listCache = getListCacheStore();
	const pager = getMobilePagerStore();

	const MOBILE_BREAKPOINT = '(max-width: 767px)';
	const getIsMobile = () => {
		if (typeof window === 'undefined') {
			return page.data.isMobile ?? false;
		}
		return window.matchMedia(MOBILE_BREAKPOINT).matches;
	};
	let isMobile = $state(getIsMobile());

	// State declarations
	let dragOffset = $state<number | null>(null);
	let swipeNeedsLoadingAtStart = $state(false);
	let isPendingNavigation = $state(false);
	let isTransitioningOut = $state(false);
	let prefetchStarted = false;
	let swipeDirection = $state<'left' | 'right' | null>(null);
	let viewportWidth = $state(0);

	// Derived declarations
	const hasLeft = $derived(!!left || (navStore.activeTab >= 0 && navStore.activeTab <= 2));
	const resolvedLeftHref = $derived(leftHref ?? navStore.backTarget);
	const hasRight = $derived(!!right);
	const resolvedRightHref = $derived(rightHref);

	// Configuration-driven Cache checks (removes hardcoding)
	const isLeftTargetTabRoot = $derived(resolvedLeftHref ? isPagerRoute(resolvedLeftHref) : false);
	const isLeftCachePopulated = $derived(
		resolvedLeftHref
			? (MOBILE_TABS.find((tab) => tab.href === resolvedLeftHref)?.checkCache() ?? false)
			: false
	);
	const leftNeedsLoading = $derived(isLeftTargetTabRoot && !isLeftCachePopulated);

	const isRightTargetTabRoot = $derived(
		resolvedRightHref ? isPagerRoute(resolvedRightHref) : false
	);
	const isRightCachePopulated = $derived(
		resolvedRightHref
			? (MOBILE_TABS.find((tab) => tab.href === resolvedRightHref)?.checkCache() ?? false)
			: false
	);
	const rightNeedsLoading = $derived(isRightTargetTabRoot && !isRightCachePopulated);

	const maxDrag = $derived(typeof window !== 'undefined' ? window.innerWidth * 0.3 : 100);
	const W = $derived(typeof window !== 'undefined' ? window.innerWidth : 375);

	const currentRevealWidth = $derived<number>(
		isTransitioningOut
			? W
			: isPendingNavigation
				? maxDrag
				: dragOffset !== null
					? Math.abs(dragOffset)
					: 0
	);

	const progress = $derived(maxDrag > 0 ? Math.min(1, currentRevealWidth / maxDrag) : 0);

	const targetTab = $derived(
		swipeDirection === 'left'
			? resolvedRightHref
				? MOBILE_TABS.find((tab) => tab.isActive(resolvedRightHref))
				: null
			: resolvedLeftHref
				? MOBILE_TABS.find((tab) => tab.isActive(resolvedLeftHref))
				: null
	);

	const isCircle = $derived(currentRevealWidth < 40);
	const chipStyleWidth = $derived(isCircle ? '36px' : 'auto');
	const chipStyleHeight = $derived('36px');
	const chipPadding = $derived(isCircle ? 'padding: 0;' : 'padding: 6px 12px;');

	const baseScale = $derived(
		currentRevealWidth < 40 ? currentRevealWidth / 40 : progress >= 0.9 ? 1.3 : 1 + progress * 0.15
	);
	const chipScale = $derived(isTransitioningOut ? 1.6 : isPendingNavigation ? 1.15 : baseScale);
	const chipOpacity = $derived(isTransitioningOut ? 0 : 1);

	const textProgress = $derived(
		Math.max(0, Math.min(1, (currentRevealWidth - 40) / (maxDrag - 40)))
	);
	const chipMaxWidth = $derived(isCircle ? 36 : 36 + textProgress * 94);
	const textMaxWidth = $derived(isCircle ? 0 : textProgress * 70);

	let leftEl = $state<HTMLElement | null>(null);
	const leftScrollTop = $derived(resolvedLeftHref ? pageScrollStore.get(resolvedLeftHref) : 0);

	let rightEl = $state<HTMLElement | null>(null);
	const rightScrollTop = $derived(resolvedRightHref ? pageScrollStore.get(resolvedRightHref) : 0);

	let centerEl = $state<HTMLElement | null>(null);
	const currentScrollTop = $derived(page.url.pathname ? pageScrollStore.get(page.url.pathname) : 0);

	const shouldAnimateEnter = () => {
		if (leftNeedsLoading) return false; // Never animate entry from loading swipe
		if (!hasLeft || !resolvedLeftHref) return false;
		if (navStore.direction !== 'forward') return false;
		if (navStore.activeStack.length < 2) return false;
		const prevPath = navStore.activeStack[navStore.activeStack.length - 2].pathname;
		return prevPath === resolvedLeftHref;
	};

	const isEntering = shouldAnimateEnter();
	let trackEl = $state<HTMLElement | null>(null);
	let transitionEnabled = $state(false);
	// svelte-ignore state_referenced_locally
	let snapIndex = $state(isEntering ? 0 : hasLeft && !swipeNeedsLoadingAtStart ? 1 : 0);

	const panelCount = $derived(
		(hasLeft && !swipeNeedsLoadingAtStart ? 1 : 0) +
			1 +
			(hasRight && !swipeNeedsLoadingAtStart ? 1 : 0)
	);
	const ACTIVE = $derived(hasLeft && !swipeNeedsLoadingAtStart ? 1 : 0);
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
		if (rightEl && rightScrollTop > 0) {
			rightEl.scrollTop = rightScrollTop;
			const rafId = requestAnimationFrame(() => {
				if (rightEl) {
					rightEl.scrollTop = rightScrollTop;
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

	$effect(() => {
		if (!isMobile || centerTab === undefined) return;
		let progressVal: number;
		if (dragOffset !== null && viewportWidth) {
			const dragProgress = Math.max(0, Math.min(1, -dragOffset / viewportWidth));
			progressVal =
				rightTab !== undefined ? centerTab + dragProgress * (rightTab - centerTab) : centerTab;
		} else {
			const rightPanelIdx = hasRight && !swipeNeedsLoadingAtStart ? panelCount - 1 : -1;
			progressVal = snapIndex === rightPanelIdx && rightTab !== undefined ? rightTab : centerTab;
		}
		pager.set({ fractionalIndex: progressVal, dragging: dragOffset !== null, active: true });
	});

	const trackTranslateX = $derived<string>(
		!isMobile
			? '0px'
			: swipeNeedsLoadingAtStart
				? isTransitioningOut
					? `${swipeDirection === 'left' ? -W : W}px`
					: isPendingNavigation
						? `${swipeDirection === 'left' ? -maxDrag : maxDrag}px`
						: dragOffset !== null
							? `${dragOffset}px`
							: '0px'
				: dragOffset !== null
					? `calc(-${ACTIVE * STEP_PERCENT}% + ${dragOffset}px)`
					: `-${snapIndex * STEP_PERCENT}%`
	);

	const trackStyle = $derived(
		!isMobile
			? 'width: 100%; transform: none; display: block;'
			: `width: ${panelCount * 100}%; transform: translateX(${trackTranslateX}); display: flex; height: 100%;${dragOffset !== null || !transitionEnabled ? ' transition: none !important;' : ''}`
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
	const rightStyle = $derived(
		!isMobile
			? 'display: none;'
			: `width: ${sectionWidth}; height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain; touch-action: pan-y pinch-zoom;`
	);

	const viewportStyle = $derived(
		!isMobile
			? 'touch-action: auto; overflow: visible; height: auto; width: 100%; position: relative;'
			: 'touch-action: pan-y pinch-zoom; flex: 1 1 auto; height: 100%; position: relative; width: 100%; overflow: hidden;'
	);

	function onSwipeMove(deltaX: number) {
		if (dragOffset === null) {
			swipeDirection = deltaX > 0 ? 'right' : deltaX < 0 ? 'left' : null;
			if (swipeDirection === 'right') {
				swipeNeedsLoadingAtStart = leftNeedsLoading;
			} else if (swipeDirection === 'left') {
				swipeNeedsLoadingAtStart = rightNeedsLoading;
			} else {
				swipeNeedsLoadingAtStart = false;
			}
		}

		if (swipeNeedsLoadingAtStart) {
			const maxDragDist = window.innerWidth * 0.3;
			if (swipeDirection === 'right') {
				dragOffset = maxDragDist * Math.tanh(deltaX / (maxDragDist * 1.2));

				if (dragOffset >= 30 && !prefetchStarted && resolvedLeftHref) {
					prefetchStarted = true;
					void preloadData(resolvedLeftHref).catch(() => {});
				}
			} else if (swipeDirection === 'left') {
				dragOffset = maxDragDist * Math.tanh(deltaX / (maxDragDist * 1.2));

				if (dragOffset <= -30 && !prefetchStarted && resolvedRightHref) {
					prefetchStarted = true;
					void preloadData(resolvedRightHref).catch(() => {});
				}
			}
		} else {
			if ((deltaX > 0 && hasLeft) || (deltaX < 0 && hasRight)) {
				dragOffset = deltaX;
			}
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
		if (swipeNeedsLoadingAtStart) {
			const maxDragDist = window.innerWidth * 0.3;
			const dragDist = Math.abs(dragOffset ?? 0);
			const committed = dragDist >= maxDragDist * 0.75 || Math.abs(deltaX) >= SWIPE_COMMIT;
			if (committed) {
				const targetHref = swipeDirection === 'left' ? resolvedRightHref : resolvedLeftHref;
				if (targetHref) {
					const isPopulated =
						MOBILE_TABS.find((tab) => tab.href === targetHref)?.checkCache() ?? false;
					if (isPopulated) {
						isTransitioningOut = true;
						dragOffset = null;
						setTimeout(() => {
							void goto(targetHref, { replaceState: true }).then(() => {
								isTransitioningOut = false;
								prefetchStarted = false;
								swipeNeedsLoadingAtStart = false;
								swipeDirection = null;
							});
						}, 300);
					} else {
						isPendingNavigation = true;
						dragOffset = null;
						preloadData(targetHref)
							.catch(() => {})
							.then(() => {
								isPendingNavigation = false;
								isTransitioningOut = true;
								setTimeout(() => {
									void goto(targetHref, { replaceState: true }).then(() => {
										isTransitioningOut = false;
										prefetchStarted = false;
										swipeNeedsLoadingAtStart = false;
										swipeDirection = null;
									});
								}, 300);
							});
					}
				}
			} else {
				dragOffset = null;
				prefetchStarted = false;
				setTimeout(() => {
					transitionEnabled = false;
					swipeNeedsLoadingAtStart = false;
					swipeDirection = null;
					setTimeout(() => {
						transitionEnabled = true;
					}, 50);
				}, 300);
			}
		} else {
			const leftIdx = hasLeft ? 0 : -1;
			const rightIdx = hasRight ? panelCount - 1 : -1;
			const committedLeft = deltaX >= SWIPE_COMMIT && (hasLeft ? resolvedLeftHref : fallbackRoute);
			const committedRight = deltaX <= -SWIPE_COMMIT && rightIdx >= 0 && resolvedRightHref;

			if (committedLeft) {
				const consumed = backHandler.dispatch();
				if (!consumed) {
					if (hasLeft) {
						snapIndex = leftIdx;
						const back = backLandsOn(resolvedLeftHref);
						pendingNav = { href: resolvedLeftHref, back, replaceState: true };
					} else {
						if (navStore.activeStack.length > 1) {
							history.back();
						} else {
							pendingNav = { href: fallbackRoute, back: false, replaceState: true };
						}
					}
				} else {
					snapIndex = ACTIVE;
				}
			} else if (committedRight) {
				snapIndex = rightIdx;
				pendingNav = { href: resolvedRightHref, back: false, replaceState: false };
			} else {
				snapIndex = ACTIVE;
			}
			dragOffset = null;
		}
	}

	function onTrackTransitionEnd(event: TransitionEvent): void {
		if (event.target !== event.currentTarget) return;
		if (event.propertyName !== 'transform' || !pendingNav) return;
		const nav = pendingNav;
		pendingNav = null;
		if (nav.back) {
			history.back();
		} else {
			void goto(nav.href, { replaceState: nav.replaceState });
		}
	}

	onMount(() => {
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
			const target = e.target;
			if (!target) return;
			if (target === document || target === window) {
				window.scrollTo(0, 0);
			} else if (target instanceof HTMLElement) {
				if (!target.classList.contains('scroll-pane')) {
					if (target.scrollTop !== 0) target.scrollTop = 0;
					if (target.scrollLeft !== 0) target.scrollLeft = 0;
				}
			}
		};
		window.addEventListener('scroll', forceZeroScroll, true);

		let enterRaf = 0;
		if (isEntering && isMobile) {
			if (trackEl) {
				// Force layout reflow to register initial style state before transition
				void trackEl.offsetHeight;
			}
			enterRaf = requestAnimationFrame(() => {
				enterRaf = requestAnimationFrame(() => {
					transitionEnabled = true;
					if (trackEl) void trackEl.offsetHeight;
					snapIndex = ACTIVE;
				});
			});
		} else {
			transitionEnabled = true;
		}

		return () => {
			mq.removeEventListener('change', sync);
			window.removeEventListener('scroll', forceZeroScroll, true);
			document.documentElement.classList.remove('fixed-viewport');
			if (enterRaf) cancelAnimationFrame(enterRaf);
			pager.set({ fractionalIndex: 0, dragging: false, active: false });
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

<div
	bind:this={viewportEl}
	class={isMobile ? 'overflow-hidden h-full w-full' : ''}
	style={viewportStyle}
	use:detectSwipe={{
		onMove: onSwipeMove,
		onEnd: onSwipeEnd,
		disabled: () => !isMobile || (!hasLeft && !hasRight)
	}}
	use:measureViewport
>
	<div
		bind:this={trackEl}
		class={isMobile ? 'flex items-start transition-transform duration-200 h-full w-full' : ''}
		style={trackStyle}
		ontransitionend={onTrackTransitionEnd}
	>
		{#if hasLeft && isMobile && !swipeNeedsLoadingAtStart}
			<section
				bind:this={leftEl}
				class="shrink-0 p-3 scroll-pane md:hidden"
				style={leftStyle}
				onscroll={(e) => {
					if (resolvedLeftHref && e.currentTarget.scrollTop > 0) {
						pageScrollStore.capture(resolvedLeftHref, e.currentTarget.scrollTop);
					}
				}}
			>
				{#if left}
					{@render left()}
				{:else if navStore.activeTab === 0}
					<DiscussionsPanel
						discussions={listCache.home?.discussions}
						currentPage={listCache.home?.page ?? 1}
						totalPages={listCache.home?.totalPages ?? 1}
						t={page.data.t}
						buildPageUrl={(page) => (page === 1 ? '/' : `/discussions/p${page}`)}
						paginate={true}
					/>
				{:else if navStore.activeTab === 1}
					<ActivityPanel
						activities={listCache.activity?.activities ?? []}
						currentPage={listCache.activity?.page ?? 1}
						totalPages={listCache.activity?.totalPages ?? 1}
						activityDraft={listCache.activity?.activityDraft ?? null}
						mentionedUsers={listCache.activity?.mentionedUsers ?? {}}
						t={page.data.t}
						user={page.data.user}
						paginate={true}
					/>
				{:else if navStore.activeTab === 2}
					<MessagesPanel
						conversations={(listCache.messages?.conversations ?? []) as ConversationListItem[]}
						currentPage={listCache.messages?.page ?? 1}
						totalPages={listCache.messages?.totalPages ?? 1}
						t={page.data.t}
						paginate={true}
					/>
				{/if}
			</section>
		{/if}
		<section
			bind:this={centerEl}
			class="shrink-0 p-3 scroll-pane detail-scroll-pane h-full w-full"
			style={centerStyle}
		>
			{@render children()}
		</section>
		{#if hasRight && isMobile && !swipeNeedsLoadingAtStart}
			<section
				bind:this={rightEl}
				class="shrink-0 p-3 scroll-pane md:hidden"
				style={rightStyle}
				onscroll={(e) => {
					if (resolvedRightHref && e.currentTarget.scrollTop > 0) {
						pageScrollStore.capture(resolvedRightHref, e.currentTarget.scrollTop);
					}
				}}
			>
				{#if right}
					{@render right()}
				{/if}
			</section>
		{/if}
	</div>

	{#if swipeNeedsLoadingAtStart && isMobile && (dragOffset !== null || isPendingNavigation || isTransitioningOut)}
		<div
			class="loading-overlay absolute inset-y-0 z-50 flex items-center justify-center pointer-events-none"
			class:dragging={dragOffset !== null}
			style="{swipeDirection === 'left'
				? 'right: 0;'
				: 'left: 0;'} width: {currentRevealWidth}px; opacity: {isTransitioningOut ? 0 : 1};"
		>
			<div
				class="loading-chip bg-neutral text-neutral-content rounded-full flex items-center justify-center shadow-lg font-medium whitespace-nowrap overflow-hidden"
				class:gap-2={!isCircle}
				class:dragging={dragOffset !== null}
				class:animate-pulse={isPendingNavigation}
				style="transform: scale({chipScale}); opacity: {chipOpacity}; max-width: {chipMaxWidth}px; min-width: {isCircle
					? '36px'
					: '0px'}; height: {chipStyleHeight}; width: {chipStyleWidth}; {chipPadding}"
			>
				{#if targetTab}
					<Icon path={targetTab.icon} size={18} class="shrink-0 text-neutral-content" />
				{/if}
				<span
					class="loading-chip-text overflow-hidden text-sm whitespace-nowrap text-neutral-content"
					style="max-width: {textMaxWidth}px;"
				>
					{#if targetTab}
						{page.data.t.nav[targetTab.labelKey]}
					{/if}
				</span>
			</div>
		</div>
	{/if}
</div>

<style>
	.loading-overlay {
		background-color: var(--color-base-200);
		overflow: visible;
		transition:
			width 300ms cubic-bezier(0.25, 0.8, 0.25, 1),
			opacity 300ms ease;
	}
	.loading-overlay.dragging {
		transition: none !important;
	}
	.loading-chip {
		font-family: var(--font-sans);
		transition:
			transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1),
			opacity 300ms ease,
			max-width 200ms ease;
	}
	.loading-chip.dragging {
		transition:
			max-width 0s linear,
			transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.loading-chip-text {
		display: inline-block;
		transition: max-width 200ms ease;
	}
	.loading-chip.dragging .loading-chip-text {
		transition: none !important;
	}
</style>
