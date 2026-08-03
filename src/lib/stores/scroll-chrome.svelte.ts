/**
 * Scroll-Chrome Store - Module-level reactive flag for whether the app chrome
 * (top App Bar) should be translated out of view to reclaim vertical space
 * while reading. Driven by scroll direction: scrolling down hides the chrome,
 * scrolling up (or being near the top of the page) reveals it. The same
 * direction/threshold logic runs on all viewports (mobile and desktop);
 * the reactive outputs are read by the Header (hide-on-scroll), the FAB layer
 * (hide-on-scroll), and NavPipelineHost (scroll-container override).
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
	readonly translateY: number;
	readonly headerHeight: number;
	setHeaderHeight: SetHeaderHeightHandler;
	start: VoidHandler;
	show: VoidHandler;
	/** Register the element whose scrolling now drives hide-on-scroll. The mobile
	 * NavPipelineHost / NavPipelineTabHost routes lock the document window (`html.fixed-viewport`:
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
	 *  source: the pipeline host's setScrollContainer $effect reads
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

let translateY = $state(0);
// Seeded to the mobile header height; Header's ResizeObserver reports the real
// height (which differs on desktop) via setHeaderHeight on mount.
let headerHeight = $state(56);
let lastY = 0;
let rafId = 0;
let started = false;
// While true, evaluate() holds the header's current translateY and only refreshes
// lastY. Set by holdThroughNavigation during a navigation that programatically
// scrolls the window (hash-enter / swipe-back) so the header does not react to
// that intermediate scroll; releaseNavigation clears it at the landing.
let frozen = false;
// When set, the page scrolls inside this element instead of the window (mobile
// NavPipelineHost / NavPipelineTabHost routes), so evaluate() reads its scrollTop and the scroll
// listener is attached to it. null = scroll the window (homepage / desktop).
let containerEl: HTMLElement | null = null;
// A nested scroller that claimed the scroll source. Read by the pipeline host's
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
		// intent. `releaseNavigation()` re-syncs the header to the landing position.
		lastY = y;
		return;
	}
	const delta = y - lastY;
	lastY = y;
	// Pinned to the top: always show so the chrome does not vanish at rest.
	if (y < TOP_THRESHOLD) {
		translateY = 0;
		return;
	}

	let newTranslateY = translateY - delta;
	if (newTranslateY > 0) {
		newTranslateY = 0;
	} else if (newTranslateY < -headerHeight) {
		newTranslateY = -headerHeight;
	}

	translateY = newTranslateY;
}

function onScroll(): void {
	if (rafId) return;
	rafId = window.requestAnimationFrame(() => {
		rafId = 0;
		evaluate();
	});
}

function start(): void {
	if (started || typeof window === 'undefined') return;
	started = true;
	lastY = readY();
	window.addEventListener('scroll', onScroll, { passive: true });
}

function show(): void {
	translateY = 0;
	if (typeof window !== 'undefined') {
		lastY = readY();
	}
}

function setScrollContainer(el: HTMLElement | null): void {
	if (containerEl === el) return;
	if (containerEl) {
		containerEl.removeEventListener('scroll', onScroll);
	}
	containerEl = el;
	if (el) {
		el.addEventListener('scroll', onScroll, { passive: true });
		// Defer the scroll-position seed to the next animation frame. Reading
		// `el.scrollTop` synchronously here, on a host that just mounted and
		// wrote a batch of DOM (panels, scope content), forces the browser to
		// flush pending layout work to satisfy the read; under mobile-class
		// CPU that forced reflow dominates the search-enter frame budget (the
		// host has two setScrollContainer calls in its reactive cascade, so
		// the cost stacks). rAF is the existing mechanism the layer already
		// uses for per-frame work; no setTimeout, no CSS transition. The seed
		// only feeds `evaluate()`'s delta math on the first real scroll,
		// which always fires after this rAF has run (the user cannot scroll
		// the destination inside the same frame as the click). The identity
		// guard re-checks `containerEl === el` inside the rAF so a stale
		// callback (the host unmounted before the next frame) cannot write a
		// detached element's scrollTop into lastY.
		const target = el;
		window.requestAnimationFrame(() => {
			if (containerEl === target) lastY = target.scrollTop;
		});
	} else {
		// Null branch (host unmount / no scroll container): defer the window
		// scrollY read for the same reason - it is a geometry read that
		// would otherwise force a layout flush in the middle of the route
		// swap's reactive cascade. lastY stays at its previous value until
		// the next frame, which is safe: with containerEl null the next
		// scroll event reads `readY()` which returns `window.scrollY`
		// directly, so the seed here only avoids a one-frame delta miscalc
		// if the user scrolls the window during the next frame (a path that
		// never runs on a NavPipelineHost route, where the window does not
		// scroll).
		window.requestAnimationFrame(() => {
			if (containerEl === null && typeof window !== 'undefined') {
				lastY = window.scrollY;
			}
		});
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
		get translateY() {
			return translateY;
		},
		get headerHeight() {
			return headerHeight;
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
