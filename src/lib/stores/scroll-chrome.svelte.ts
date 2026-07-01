/**
 * Scroll-Chrome Store - Module-level reactive flag for whether the app chrome
 * (top App Bar) should be translated out of view to reclaim vertical space
 * while reading. Driven by scroll direction: scrolling down hides the chrome,
 * scrolling up (or being near the top of the page) reveals it. The same
 * direction/threshold logic runs on all viewports (mobile and desktop) so the
 * single sticky Header in AppShell is the only consumer.
 *
 * `headerHeight` is reported live by Header's ResizeObserver
 * (`setHeaderHeight`), so the clamp range adapts to the current viewport's
 * header height (56px mobile, taller on desktop) without hardcoding.
 *
 * A single passive scroll listener (rAF-throttled) is attached the first time
 * `start()` runs. The module-level singleton keeps it alive across client-side
 * navigations even though DualColumnLayout remounts per route, so the listener
 * is never double-attached and never torn down mid-session.
 */
import type { VoidHandler } from '$lib/types/handlers';

type SetHeaderHeightHandler = (height: number) => void;
type HoldNavigationHandler = (pinVisible: boolean) => void;
type SetScrollContainerHandler = (el: HTMLElement | null) => void;
type ReleaseContainerHandler = (el: HTMLElement | null) => void;

interface ScrollChromeStore {
	readonly hidden: boolean;
	readonly translateY: number;
	readonly headerHeight: number;
	readonly scrolling: boolean;
	setHeaderHeight: SetHeaderHeightHandler;
	start: VoidHandler;
	show: VoidHandler;
	/** Register the element whose scrolling now drives hide-on-scroll. The mobile
	 * GesturePageLayout routes lock the document window (`html.fixed-viewport`:
	 * html/body are position:fixed; overflow:hidden) and scroll the page inside a
	 * centre panel (`.detail-scroll-pane`) instead; on those routes the window
	 * never scrolls, so the store must listen to that container. Pass null on
	 * unmount to revert to the window (the homepage / desktop scroll the window). */
	setScrollContainer: SetScrollContainerHandler;
	/** Conditionally release the scroll container: clear it ONLY if `el` is still
	 *  the active container. Used in $effect cleanups so a stale teardown (from a
	 *  route-layout that has already yielded to the destination) never clobbers a
	 *  fresh owner that mounted in the same SPA swap. The destination's mount
	 *  re-sets the container via setScrollContainer, so the identity guard makes
	 *  the handoff self-healing regardless of mount/destroy ordering. */
	releaseContainer: ReleaseContainerHandler;
	/** A nested scroller owner (a scope panel inside a pager) claims the scroll
	 *  source: GesturePageLayout's setScrollContainer $effect reads
	 *  `override ?? centerEl`, so the override wins deterministically without a
	 *  parent/child $effect ordering race. null clears it. */
	setOverride: SetScrollContainerHandler;
	readonly override: HTMLElement | null;
	/** A navigation that will programmatically scroll the window (a hash-anchored
	 * thread enter, or a swipe-back to the list) is starting: hold the header so
	 * hide-on-scroll does not react to the intermediate top→position scroll.
	 * `pinVisible` pins it shown first (hash-enter lands mid-thread).
	 * Pair every call with `releaseNavigation` at the landing (or the fallback
	 * timer in the root layout). */
	holdThroughNavigation: HoldNavigationHandler;
	/** A navigation has landed: release the hold and pin the header visible. A
	 * navigation restores scroll programmatically (not via active scrolling), so
	 * the chrome should stay put through the restore instead of hide-on-scroll
	 * vanishing it; the next real scroll re-evaluates. */
	releaseNavigation: VoidHandler;
}

const TOP_THRESHOLD = 8; // px from top below which chrome always shows

let hidden = $state(false);
let translateY = $state(0);
let scrolling = $state(false);
// Seeded to the mobile header height; Header's ResizeObserver reports the real
// height (which differs on desktop) via setHeaderHeight on mount.
let headerHeight = $state(56);
let lastY = 0;
let rafId = 0;
let started = false;
let scrollTimeoutId = 0;
// While true, evaluate() holds the header's current translateY and only refreshes
// lastY. Set by holdThroughNavigation during a navigation that programatically
// scrolls the window (hash-enter / swipe-back) so the header does not react to
// that intermediate scroll; releaseNavigation clears it at the landing.
let frozen = false;
// When set, the page scrolls inside this element instead of the window (mobile
// GesturePageLayout routes), so evaluate() reads its scrollTop and the scroll
// listener is attached to it. null = scroll the window (homepage / desktop).
let containerEl: HTMLElement | null = null;
// A nested scroller that claimed the scroll source. Read by GesturePageLayout's
// sole setScrollContainer $effect as `override ?? centerEl`.
let overrideEl = $state<HTMLElement | null>(null);

/** Current scroll position from whichever element is the active scroll source. */
function readY(): number {
	return containerEl ? containerEl.scrollTop : window.scrollY;
}

function evaluate(): void {
	const y = readY();
	if (frozen) {
		// Keep lastY fresh so the post-unfreeze evaluate sees no stale delta, but do
		// not move the header - the navigation's intermediate scroll is not user
		// intent. unfreeze() re-syncs the header to the landing position.
		lastY = y;
		return;
	}
	const delta = y - lastY;
	lastY = y;
	// Pinned to the top: always show so the chrome does not vanish at rest.
	if (y < TOP_THRESHOLD) {
		hidden = false;
		translateY = 0;
		scrolling = false;
		return;
	}

	let newTranslateY = translateY - delta;
	if (newTranslateY > 0) {
		newTranslateY = 0;
	} else if (newTranslateY < -headerHeight) {
		newTranslateY = -headerHeight;
	}

	translateY = newTranslateY;
	hidden = translateY <= -headerHeight;
}

function onScroll(): void {
	scrolling = true;
	if (scrollTimeoutId) {
		window.clearTimeout(scrollTimeoutId);
	}
	scrollTimeoutId = window.setTimeout(() => {
		scrolling = false;
	}, 150);

	if (rafId) return;
	rafId = window.requestAnimationFrame(() => {
		rafId = 0;
		evaluate();
	});
}

function onScrollEnd(): void {
	scrolling = false;
	if (scrollTimeoutId) {
		window.clearTimeout(scrollTimeoutId);
		scrollTimeoutId = 0;
	}
}

function start(): void {
	if (started || typeof window === 'undefined') return;
	started = true;
	lastY = readY();
	window.addEventListener('scroll', onScroll, { passive: true });
	window.addEventListener('scrollend', onScrollEnd, { passive: true });
}

function show(): void {
	hidden = false;
	translateY = 0;
	scrolling = false;
	if (typeof window !== 'undefined') {
		lastY = readY();
	}
	if (scrollTimeoutId) {
		window.clearTimeout(scrollTimeoutId);
		scrollTimeoutId = 0;
	}
}

function setScrollContainer(el: HTMLElement | null): void {
	if (containerEl === el) return;
	if (containerEl) {
		containerEl.removeEventListener('scroll', onScroll);
		containerEl.removeEventListener('scrollend', onScrollEnd);
	}
	containerEl = el;
	if (el) {
		el.addEventListener('scroll', onScroll, { passive: true });
		el.addEventListener('scrollend', onScrollEnd, { passive: true });
		// Re-seed to the container's current position so the first real scroll
		// produces the right delta (not a jump from the window's stale lastY).
		lastY = el.scrollTop;
	} else if (typeof window !== 'undefined') {
		lastY = window.scrollY;
	}
}

function releaseContainer(el: HTMLElement | null): void {
	if (containerEl === el) setScrollContainer(null);
}

function setOverride(el: HTMLElement | null): void {
	overrideEl = el;
}

function setHeaderHeight(height: number): void {
	headerHeight = height;
	if (translateY < -headerHeight) {
		translateY = -headerHeight;
	}
}

function freeze(): void {
	frozen = true;
}

function holdThroughNavigation(pinVisible: boolean): void {
	if (pinVisible) show();
	freeze();
}

function releaseNavigation(): void {
	// A navigation landing is not an active scroll: clear the hold and pin the
	// header visible so the chrome is stable through the restore (the next real
	// scroll re-evaluates). show() re-syncs lastY/translateY but does not touch
	// `frozen`, so clear that explicitly.
	frozen = false;
	show();
}

export function getScrollChromeStore(): ScrollChromeStore {
	return {
		get hidden() {
			return hidden;
		},
		get translateY() {
			return translateY;
		},
		get headerHeight() {
			return headerHeight;
		},
		get scrolling() {
			return scrolling;
		},
		setHeaderHeight,
		start,
		setScrollContainer,
		releaseContainer,
		get override() {
			return overrideEl;
		},
		setOverride,
		holdThroughNavigation,
		releaseNavigation,
		show
	};
}
