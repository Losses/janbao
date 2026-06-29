<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { preloadData, afterNavigate, beforeNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { getNavigationStore } from '$lib/stores/navigation.svelte';
	import { getPageScrollStore } from '$lib/stores/page-scroll.svelte';
	import { backHandler } from '$lib/stores/navigation.svelte';
	import { detectSwipe } from '$lib/actions/swipe';
	import { isTabRootPath } from '$lib/utils/history-nav';
	import type { Action } from 'svelte/action';
	import { getListCacheStore } from '$lib/stores/list-cache.svelte';
	import LoadingChip from '$lib/components/atoms/LoadingChip.svelte';
	import {
		MOBILE_TABS,
		isPagerRoute,
		getCurrentTabIndex,
		HEADER_MORPH_THRESHOLD,
		PILL_EXPANSION_THRESHOLD
	} from '$lib/utils/mobile-tabs';
	import { getMobilePagerStore } from '$lib/stores/mobile-pager.svelte';
	import { getScrollChromeStore } from '$lib/stores/scroll-chrome.svelte';

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
	// On mobile this layout locks the document window (html.fixed-viewport) and
	// scrolls the active panel inside `.detail-scroll-pane`; tell the shared
	// scroll-chrome store to drive the Header from THAT container instead of the
	// window (which never scrolls here). Desktop scrolls the window, so it only
	// registers on mobile. Reverts automatically on unmount (null).
	const scrollChrome = getScrollChromeStore();

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
	let rawDragOffset = $state<number | null>(null);
	let swipeNeedsLoadingAtStart = $state(false);
	let isPendingNavigation = $state(false);
	let isTransitioningOut = $state(false);
	let prefetchStarted = false;
	let swipeDirection = $state<'left' | 'right' | null>(null);
	let viewportWidth = $state(0);
	// True from the moment a committed swipe dispatches its navigation (in
	// onTrackTransitionEnd) until that navigation lands. While set, the pager-
	// driving $effect treats the gesture as still "committed" and HOLDS the tab
	// pill at the target tab - without this, clearing `pendingNav` (so the
	// transitionend handler doesn't double-fire) drops `committed` to false a
	// frame before the route swaps, and the effect's "true rest" branch resets
	// the pill to fromIdx (-1 on a deep page), collapsing it and dropping its
	// highlight until the destination pager mounts. See swipe-back-pill-flicker.

	// Derived declarations
	const hasLeft = $derived(!!left || (navStore.activeTab >= 0 && navStore.activeTab <= 2));
	const resolvedLeftHref = $derived(leftHref ?? navStore.backTarget);
	// The left preview shows the tab list when back lands on the tab root. When
	// the back target is elsewhere (e.g. a thread reached before /bookmarks) the
	// target page is unmounted on this route so there is no DOM to preview - show
	// the shared LoadingChip instead of a fake list.
	const currentTabRoot = $derived(MOBILE_TABS[navStore.activeTab]?.href ?? '/');
	const backTargetIsTabRoot = $derived(resolvedLeftHref === currentTabRoot);
	const hasRight = $derived(!!right);
	const resolvedRightHref = $derived(rightHref);
	// Identity (tab labelKey) of whatever the left/right preview panel actually
	// renders, exposed as `data-preview-tab` so the exit-preview e2e can assert
	// "the revealed panel matches the tapped tab" without classifying DOM content
	// (content markers collide across pages and miss non-tab sidebars). null means
	// the panel is not a tab list; a wrong non-tab preview must still fail the test.
	const leftPreviewTab = $derived(
		leftHref
			? (MOBILE_TABS.find((tab) => tab.href === leftHref)?.labelKey ?? null)
			: left
				? null
				: (MOBILE_TABS[navStore.activeTab]?.labelKey ?? null)
	);
	const rightPreviewTab = $derived(
		rightHref ? (MOBILE_TABS.find((tab) => tab.href === rightHref)?.labelKey ?? null) : null
	);

	// Configuration-driven Cache checks (removes hardcoding)
	const isLeftTargetTabRoot = $derived(resolvedLeftHref ? isPagerRoute(resolvedLeftHref) : false);
	const isLeftCachePopulated = $derived(
		resolvedLeftHref
			? (MOBILE_TABS.find((tab) => tab.href === resolvedLeftHref)?.hasData(page.data) ?? false)
			: false
	);
	const leftNeedsLoading = $derived(isLeftTargetTabRoot && !isLeftCachePopulated);

	const isRightTargetTabRoot = $derived(
		resolvedRightHref ? isPagerRoute(resolvedRightHref) : false
	);
	const isRightCachePopulated = $derived(
		resolvedRightHref
			? (MOBILE_TABS.find((tab) => tab.href === resolvedRightHref)?.hasData(page.data) ?? false)
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
					? swipeDirection === 'left'
						? Math.max(0, -dragOffset)
						: Math.max(0, dragOffset)
					: 0
	);

	const progress = $derived(maxDrag > 0 ? Math.min(1, currentRevealWidth / maxDrag) : 0);

	// Destination of an in-flight cross-tab tab-tap exit (set in beforeNavigate).
	// The loading chip reads `targetTab` for its icon/label; without this the chip
	// would show the SOURCE page's neighbour panel (wrong tab) for a cross-tab
	// exit. null outside a cross-tab chip exit.
	let pendingTargetHref = $state<string | null>(null);

	const targetTab = $derived(
		pendingTargetHref
			? (MOBILE_TABS.find((tab) => tab.href === pendingTargetHref) ?? null)
			: swipeDirection === 'left'
				? resolvedRightHref
					? MOBILE_TABS[navStore.getTabFromPath(resolvedRightHref)]
					: null
				: resolvedLeftHref
					? MOBILE_TABS[navStore.getTabFromPath(resolvedLeftHref)]
					: null
	);

	const isCircle = $derived(currentRevealWidth < 40);

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
	let transitionEnabled = $state(true);
	// svelte-ignore state_referenced_locally
	// Start at 0 (the list-preview frame) only when the slide-in will actually
	// play, i.e. entering AND on mobile. On desktop the pager is display:block
	// and never animates, so snapIndex must init at ACTIVE - otherwise it stays
	// stranded at 0 (enterRaf below is mobile-only) and a later resize into
	// mobile would rest on the left/list panel instead of the centre thread.
	let snapIndex = $state(isEntering && isMobile ? 0 : hasLeft && !swipeNeedsLoadingAtStart ? 1 : 0);

	const panelCount = $derived(
		(hasLeft && !swipeNeedsLoadingAtStart ? 1 : 0) +
			1 +
			(hasRight && !swipeNeedsLoadingAtStart ? 1 : 0)
	);
	const ACTIVE = $derived(hasLeft && !swipeNeedsLoadingAtStart ? 1 : 0);
	const STEP_PERCENT = $derived(100 / panelCount);
	const SWIPE_COMMIT = 60;
	let viewportEl: HTMLElement | null = $state(null);

	// A cancelled gesture: the track slides back to rest (dragOffset -> 0). Reset
	// the chip-path flags on that transform transitionend (consumed in
	// onTrackTransitionEnd).
	let pendingCancel = $state(false);

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

	// Register the centre panel as the scroll-chrome source on mobile (see
	// scrollChrome above). Re-runs when isMobile flips (resize) or the panel
	// binds/unbinds; the cleanup reverts the store to the window on unmount.
	$effect(() => {
		if (!isMobile || !centerEl) return;
		// Sole setScrollContainer caller. Reads `override ?? centerEl` so a nested
		// scroller owner (a scope panel inside a pager, which sets the override)
		// wins deterministically: this effect re-runs when the override changes,
		// regardless of parent/child $effect flush order.
		const el = scrollChrome.override ?? centerEl;
		scrollChrome.setScrollContainer(el);
		return () => scrollChrome.setScrollContainer(null);
	});

	$effect(() => {
		if (!isMobile) return;
		if (centerTab !== undefined) {
			// Page centered on a tab (e.g. a thread / messages conversation): drive
			// the pill between centerTab and the optional rightTab as the user drags.
			let progressVal: number;
			if (dragOffset !== null && viewportWidth) {
				const dragProgress = Math.max(0, Math.min(1, -dragOffset / viewportWidth));
				progressVal =
					rightTab !== undefined ? centerTab + dragProgress * (rightTab - centerTab) : centerTab;
			} else {
				const rightPanelIdx = hasRight && !swipeNeedsLoadingAtStart ? panelCount - 1 : -1;
				progressVal = snapIndex === rightPanelIdx && rightTab !== undefined ? rightTab : centerTab;
			}
			pager.set({
				fractionalIndex: progressVal,
				dragging: dragOffset !== null,
				active: true,
				backMorph: null
			});
			return;
		}
		// Deep page with no tab of its own (bookmarks, profile, settings, search,
		// ...): the MobileTabBar would otherwise show no pill and snap only after
		// navigation. Drive the pill ourselves so a back-swipe animates it from the
		// current page's tab index (-1 = no pill) toward the back target's tab,
		// tracking the finger like the 3-tab pager does.
		const fromIdx = getCurrentTabIndex(page.url.pathname);
		const targetIdx = resolvedLeftHref ? getCurrentTabIndex(resolvedLeftHref) : -1;
		const committed =
			isPendingNavigation ||
			isTransitioningOut ||
			navStore.pendingNav !== null ||
			navStore.navInFlight;
		if (dragOffset !== null && targetIdx >= 0) {
			// The bar slides back in on `backMorph` at the full drag progress, but
			// the target tab pill lags: it stays collapsed while the bar is still
			// mostly above the viewport (the first half of the drag) and only
			// expands over the second half. Otherwise the pill finishes expanding
			// while the bar is off-screen and the expansion is never visible.
			let progress = 0;
			if (viewportWidth) {
				const rawOffset = rawDragOffset ?? dragOffset;
				if (rawOffset !== null) {
					const val = swipeDirection === 'right' ? rawOffset : -rawOffset;
					progress = Math.min(1, Math.max(0, val) / viewportWidth);
				}
			}
			const pillProgress =
				Math.max(0, progress - PILL_EXPANSION_THRESHOLD) / (1 - PILL_EXPANSION_THRESHOLD);
			pager.set({
				fractionalIndex: fromIdx + (targetIdx - fromIdx) * pillProgress,
				dragging: true,
				active: true,
				// The bar slide + hamburger<->back-arrow morph use the full progress
				// (0 = full back arrow at rest, 1 once committed toward the tab root);
				// the pill intentionally lags behind it (pillProgress above).
				backMorph: progress
			});
		} else if (committed && targetIdx >= 0) {
			// Gesture committed, navigation in flight: HOLD the pill at the target
			// (don't reset to fromIdx) so it doesn't collapse-then-re-expand before
			// the destination page's pager takes over. dragging=false lets the CSS
			// transition animate the final sliver into place.
			pager.set({ fractionalIndex: targetIdx, dragging: false, active: true, backMorph: 1 });
		} else {
			// True rest (idle, or backing toward a non-tab route): release the pager
			// so MobileTabBar falls back to the URL tab (-1 => no pill on a deep page).
			// backMorph=0 keeps the Header in deep mode (full back arrow) at rest.
			pager.set({ fractionalIndex: fromIdx, dragging: false, active: false, backMorph: 0 });
		}
	});

	const visualDragOffset = $derived<number | null>(
		dragOffset === null
			? null
			: swipeNeedsLoadingAtStart
				? dragOffset
				: swipeDirection === 'right'
					? Math.max(0, dragOffset - W * HEADER_MORPH_THRESHOLD) / (1 - HEADER_MORPH_THRESHOLD)
					: Math.min(0, dragOffset + W * HEADER_MORPH_THRESHOLD) / (1 - HEADER_MORPH_THRESHOLD)
	);

	const trackTranslateX = $derived<string>(
		!isMobile
			? '0px'
			: swipeNeedsLoadingAtStart
				? isTransitioningOut
					? `${swipeDirection === 'left' ? -W : W}px`
					: isPendingNavigation
						? `${swipeDirection === 'left' ? -maxDrag : maxDrag}px`
						: visualDragOffset !== null
							? `${visualDragOffset}px`
							: '0px'
				: visualDragOffset !== null
					? `calc(-${ACTIVE * STEP_PERCENT}% + ${visualDragOffset}px)`
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
			: 'touch-action: pan-y pinch-zoom; flex: 1 1 auto; height: 100%; position: relative; width: 100%; overflow: clip;'
	);

	function onSwipeMove(deltaX: number) {
		rawDragOffset = deltaX;
		// Show the header when a drag starts (it may be hidden from scroll);
		// the gesture reveals a new panel, so the header should be visible.
		scrollChrome.show();
		if (dragOffset === null) {
			navStore.navInFlight = false;
			const dir = deltaX > 0 ? 'right' : deltaX < 0 ? 'left' : null;
			if ((dir === 'right' && !hasLeft) || (dir === 'left' && !hasRight)) {
				return;
			}
			swipeDirection = dir;
			if (swipeDirection === 'right') {
				// The tab-list load case (target tab root not cached) OR the
				// can't-preview case (back target is not the tab root, so the target
				// page's DOM is unmounted and there's nothing real to show): both go
				// through the chip overlay path with its tanh damping + width animation.
				swipeNeedsLoadingAtStart = leftNeedsLoading || (!left && !backTargetIsTabRoot);
			} else if (swipeDirection === 'left') {
				swipeNeedsLoadingAtStart = rightNeedsLoading;
			} else {
				swipeNeedsLoadingAtStart = false;
			}
		}

		const clampedX = swipeDirection === 'right' ? Math.max(0, deltaX) : Math.min(0, deltaX);

		if (swipeNeedsLoadingAtStart) {
			const maxDragDist = window.innerWidth * 0.3;
			if (swipeDirection === 'right') {
				dragOffset = maxDragDist * Math.tanh(clampedX / (maxDragDist * 1.2));

				if (dragOffset >= 30 && !prefetchStarted && resolvedLeftHref) {
					prefetchStarted = true;
					void preloadData(resolvedLeftHref).catch(() => {});
				}
			} else if (swipeDirection === 'left') {
				dragOffset = maxDragDist * Math.tanh(clampedX / (maxDragDist * 1.2));

				if (dragOffset <= -30 && !prefetchStarted && resolvedRightHref) {
					prefetchStarted = true;
					void preloadData(resolvedRightHref).catch(() => {});
				}
			}
		} else {
			dragOffset = clampedX;
		}
	}

	function onSwipeEnd(deltaX: number, velocity: number, reversed: boolean) {
		// `reversed` = the finger rebounded from the drag's peak before lift-off
		// (change of intent): return to the current panel instead of advancing.
		if (swipeNeedsLoadingAtStart) {
			const maxDragDist = window.innerWidth * 0.3;
			const dragDist = dragOffset !== null ? Math.abs(dragOffset) : 0;
			const directionMatches =
				swipeDirection === 'right'
					? deltaX > 0 && (dragOffset ?? 0) > 0
					: deltaX < 0 && (dragOffset ?? 0) < 0;
			const committed =
				!reversed &&
				directionMatches &&
				(dragDist >= maxDragDist * 0.75 || Math.abs(deltaX) >= SWIPE_COMMIT);
			if (committed) {
				if (swipeDirection === 'right' && !isLeftTargetTabRoot) {
					// Back target is not the tab root (e.g. a thread reached before
					// /bookmarks): the chip overlay stood in for the unmounted target
					// page. Commit to history.back() to land on the real previous page.
					isTransitioningOut = true;
					dragOffset = null;
					rawDragOffset = null;
					// history.back() pops when a real previous entry exists, else
					// replace onto the fallback. Resolved at commit time because the
					// dispatch (onTrackTransitionEnd) runs later, on transitionend.
					navStore.setPendingNav(fallbackRoute, 'link');
					return;
				}
				const targetHref = swipeDirection === 'left' ? resolvedRightHref : resolvedLeftHref;
				if (targetHref) {
					const isPopulated =
						MOBILE_TABS.find((tab) => tab.href === targetHref)?.hasData(page.data) ?? false;
					if (isPopulated) {
						isTransitioningOut = true;
						dragOffset = null;
						rawDragOffset = null;
						navStore.setPendingNav(targetHref, 'link');
					} else {
						isPendingNavigation = true;
						dragOffset = null;
						rawDragOffset = null;
						void preloadData(targetHref)
							.catch(() => {})
							.then(() => {
								isPendingNavigation = false;
								isTransitioningOut = true;
								navStore.setPendingNav(targetHref, 'link');
							});
					}
				}
			} else {
				dragOffset = null;
				rawDragOffset = null;
				prefetchStarted = false;
				// The track slides back to rest (dragOffset -> 0). Reset the
				// chip-path flags on that transform transitionend (pendingCancel,
				// consumed in onTrackTransitionEnd).
				pendingCancel = true;
			}
		} else {
			const leftIdx = hasLeft ? 0 : -1;
			const rightIdx = hasRight ? panelCount - 1 : -1;
			const committedLeft =
				deltaX >= SWIPE_COMMIT && !reversed && (hasLeft ? resolvedLeftHref : fallbackRoute);
			const committedRight =
				deltaX <= -SWIPE_COMMIT && !reversed && rightIdx >= 0 && resolvedRightHref;

			if (committedLeft) {
				const consumed = backHandler.dispatch();
				if (!consumed) {
					if (hasLeft) {
						snapIndex = leftIdx;
						navStore.setPendingNav(resolvedLeftHref, 'link');
					} else {
						navStore.navigateBackward(fallbackRoute);
					}
				} else {
					snapIndex = ACTIVE;
				}
			} else if (committedRight) {
				snapIndex = rightIdx;
				navStore.setPendingNav(resolvedRightHref, 'link');
			} else {
				snapIndex = ACTIVE;
			}
			dragOffset = null;
			rawDragOffset = null;
		}
	}

	function onTrackTransitionEnd(event: TransitionEvent): void {
		if (event.target !== event.currentTarget) return;
		if (event.propertyName !== 'transform') return;
		if (navStore.pendingNav) {
			navStore.executePendingNav();
			return;
		}
		// Cancelled gesture: the track slid back to rest (dragOffset -> 0). The
		// chip overlay already unmounted when dragOffset cleared; reset the
		// remaining chip-path flags now that the slide-back finished, then
		// re-enable transitions on the next frame.
		if (pendingCancel) {
			pendingCancel = false;
			transitionEnabled = false;
			swipeNeedsLoadingAtStart = false;
			swipeDirection = null;
			requestAnimationFrame(() => {
				transitionEnabled = true;
			});
		}
	}

	beforeNavigate((navigation) => {
		const { to, from, cancel, type } = navigation;
		if (!to || !from) return;

		// Only animate on mobile
		if (!isMobile) return;

		// If a navigation is already in flight or transitioning, let it pass.
		// isPendingNavigation covers the cross-tab chip exit (which sets no
		// pendingNav) just as pendingNav covers the same-panel slide.
		if (
			navStore.navInFlight ||
			navStore.pendingNav !== null ||
			isTransitioningOut ||
			isPendingNavigation ||
			pendingCancel
		)
			return;

		// We only want to animate if we are exiting the detail page to a tab root page
		if (!isTabRootPath(to.url.pathname)) return;

		const toTabIdx = navStore.getTabFromPath(to.url.pathname);
		const currentTabIdx = centerTab ?? getCurrentTabIndex(page.url.pathname);
		const target = to.url.pathname + to.url.search;

		// Same-panel exit: the target matches a panel this page already rendered
		// (its own left/right list), so the slide reveals the CORRECT list.
		const matchesPreRenderedPanel =
			to.url.pathname === resolvedLeftHref || to.url.pathname === resolvedRightHref;

		if (!matchesPreRenderedPanel) {
			// Cross-tab exit: neither pre-rendered panel matches the target. Sliding
			// to either neighbour would flash the WRONG list for ~200ms. Route
			// through the loading-chip overlay (the same primitive a back-swipe to an
			// uncached target uses) so no panel is revealed: cancel, show the chip,
			// preload the target, then navigate with the SAME history semantics as
			// the same-panel path. history.back() on a back-hop (not a goto push) so
			// repeated tab toggles collapse instead of trapping the user
			// (history-nav no-back-trap). onTrackTransitionEnd dispatches the nav on
			// the slide-out transitionend; flags clear in afterNavigate.
			cancel();
			swipeNeedsLoadingAtStart = true;
			swipeDirection = toTabIdx > currentTabIdx ? 'left' : 'right';
			pendingTargetHref = to.url.pathname;
			prefetchStarted = true;
			isPendingNavigation = true;
			void preloadData(target)
				.catch(() => {})
				.then(() => {
					isPendingNavigation = false;
					isTransitioningOut = true;
					navStore.setPendingNav(target, type);
				});
			return;
		}

		// Same-panel: snap to the matching neighbour panel; pendingNav is consumed
		// by onTrackTransitionEnd, which dispatches history.back()/goto on the
		// transform transitionend.
		let direction: 'left' | 'right';
		let targetSnapIndex: number;
		if (toTabIdx > currentTabIdx) {
			direction = 'left'; // moving to a tab to the right -> track slides left
			// If we have a right section, slide to it (snapIndex = panelCount - 1).
			// Otherwise slide to the left (snapIndex = 0) as a fallback.
			targetSnapIndex = hasRight && !swipeNeedsLoadingAtStart ? panelCount - 1 : 0;
		} else {
			direction = 'right'; // moving to a tab to the left/same -> track slides right
			targetSnapIndex = 0; // slide to the left section (index 0)
		}

		// Cancel the SvelteKit navigation so we can play the animation first
		cancel();

		// Start the transition
		transitionEnabled = true;
		snapIndex = targetSnapIndex;
		swipeDirection = direction;

		// Save the target navigation details
		navStore.setPendingNav(target, type);
	});

	// Navigation completed (or this layout survived a same-route no-op): release
	// the hold so the pill reflects the real URL tab again. For the normal away-
	// nav this layout unmounts first and the flag dies with it.
	afterNavigate(() => {
		navStore.clearPendingNav();
		pendingCancel = false;
		isTransitioningOut = false;
		prefetchStarted = false;
		swipeNeedsLoadingAtStart = false;
		swipeDirection = null;
		pendingTargetHref = null;
	});

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
			enterRaf = requestAnimationFrame(() => {
				snapIndex = ACTIVE;
			});
		}

		return () => {
			mq.removeEventListener('change', sync);
			window.removeEventListener('scroll', forceZeroScroll, true);
			document.documentElement.classList.remove('fixed-viewport');
			if (enterRaf) cancelAnimationFrame(enterRaf);
			pager.set({ fractionalIndex: 0, dragging: false, active: false, backMorph: null });
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
	class={isMobile ? 'overflow-clip h-full w-full' : ''}
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
				data-preview-tab={leftPreviewTab}
				class="shrink-0 scroll-pane md:hidden"
				style={leftStyle}
				onscroll={(e) => {
					if (resolvedLeftHref && e.currentTarget.scrollTop > 0) {
						pageScrollStore.capture(resolvedLeftHref, e.currentTarget.scrollTop);
					}
				}}
			>
				<div class="gpl-card">
					{#if left}
						{@render left()}
					{:else}
						{@const Panel = MOBILE_TABS[navStore.activeTab]?.panel}
						{#if Panel}
							<Panel cache={listCache} t={page.data.t} user={page.data.user} />
						{/if}
					{/if}
				</div>
			</section>
		{/if}
		<section
			bind:this={centerEl}
			class="shrink-0 scroll-pane detail-scroll-pane h-full w-full"
			style={centerStyle}
		>
			<div class="gpl-card">
				{@render children()}
			</div>
		</section>
		{#if hasRight && isMobile && !swipeNeedsLoadingAtStart}
			<section
				bind:this={rightEl}
				data-preview-tab={rightPreviewTab}
				class="shrink-0 scroll-pane md:hidden"
				style={rightStyle}
				onscroll={(e) => {
					if (resolvedRightHref && e.currentTarget.scrollTop > 0) {
						pageScrollStore.capture(resolvedRightHref, e.currentTarget.scrollTop);
					}
				}}
			>
				<div class="gpl-card">
					{#if right}
						{@render right()}
					{/if}
				</div>
			</section>
		{/if}
	</div>

	{#if swipeNeedsLoadingAtStart && isMobile && (dragOffset !== null || isPendingNavigation || isTransitioningOut)}
		<div
			class="loading-overlay absolute inset-y-0 z-30 flex items-center justify-center pointer-events-none"
			class:dragging={dragOffset !== null}
			style="{swipeDirection === 'left'
				? 'right: 0;'
				: 'left: 0;'} width: {currentRevealWidth}px; opacity: {isTransitioningOut ? 0 : 1};"
		>
			<LoadingChip
				icon={targetTab?.icon}
				label={targetTab ? page.data.t.nav[targetTab.labelKey] : undefined}
				scale={chipScale}
				expanded={!isCircle}
				pulsing={isPendingNavigation}
				dragging={dragOffset !== null}
				opacity={chipOpacity}
				maxWidth={chipMaxWidth}
				{textMaxWidth}
			/>
		</div>
	{/if}
</div>

<style>
	.loading-overlay {
		background-color: var(--color-base-200);
		overflow: visible;
		transition:
			width 200ms cubic-bezier(0.25, 0.8, 0.25, 1),
			opacity 200ms ease;
	}
	.loading-overlay.dragging {
		transition: none !important;
	}
</style>
