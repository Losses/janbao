/**
 * Scroll-Chrome Store - Module-level reactive flag for whether the mobile app
 * chrome (top App Bar + bottom nav) should be hidden to reclaim vertical space
 * while reading. Driven by scroll direction: scrolling down hides the chrome,
 * scrolling up (or being near the top of the page) reveals it. Desktop is
 * unaffected - gated by a max-width:767px matchMedia - so the in-flow desktop
 * header keeps behaving as before.
 *
 * A single passive scroll listener (rAF-throttled) is attached the first time
 * `start()` runs. The module-level singleton keeps it alive across client-side
 * navigations even though DualColumnLayout remounts per route, so the listener
 * is never double-attached and never torn down mid-session.
 */
import type { VoidHandler } from '$lib/types/handlers';

type SetHeaderHeightHandler = (height: number) => void;

interface ScrollChromeStore {
	readonly hidden: boolean;
	readonly translateY: number;
	readonly scrolling: boolean;
	setHeaderHeight: SetHeaderHeightHandler;
	start: VoidHandler;
	show: VoidHandler;
	/** Temporarily stop the header reacting to scroll - used while a navigation
	 * scrolls top→hash, which would otherwise show-then-hide the header (twitch).
	 * `unfreeze` re-syncs the header to the current position. */
	freeze: VoidHandler;
	unfreeze: VoidHandler;
}

const MOBILE_BREAKPOINT = '(max-width: 767px)';
const TOP_THRESHOLD = 8; // px from top below which chrome always shows

let hidden = $state(false);
let translateY = $state(0);
let scrolling = $state(false);
let headerHeight = $state(56);
let lastY = 0;
let rafId = 0;
let started = false;
let mobileMq: MediaQueryList | null = null;
let scrollTimeoutId = 0;
// While true, evaluate() holds the header's current translateY and only refreshes
// lastY. Set during a hash-anchored navigation so the header does not react to
// SvelteKit's top→hash scroll (a show-then-hide twitch).
let frozen = false;

function evaluate(): void {
	const y = window.scrollY;
	if (frozen) {
		// Keep lastY fresh so the post-unfreeze evaluate sees no stale delta, but do
		// not move the header - the navigation's intermediate scroll is not user
		// intent. unfreeze() re-syncs the header to the landing position.
		lastY = y;
		return;
	}
	// Off-mobile (desktop): the header is in-flow, never hide.
	if (!mobileMq?.matches) {
		hidden = false;
		translateY = 0;
		scrolling = false;
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

function onBreakpoint(): void {
	// Crossing back to desktop: ensure the chrome is visible again.
	if (!mobileMq?.matches) {
		hidden = false;
		translateY = 0;
		scrolling = false;
	}
}

function start(): void {
	if (started || typeof window === 'undefined') return;
	started = true;
	mobileMq = window.matchMedia(MOBILE_BREAKPOINT);
	lastY = window.scrollY;
	window.addEventListener('scroll', onScroll, { passive: true });
	window.addEventListener('scrollend', onScrollEnd, { passive: true });
	mobileMq.addEventListener('change', onBreakpoint);
}

function show(): void {
	hidden = false;
	translateY = 0;
	scrolling = false;
	if (typeof window !== 'undefined') {
		lastY = window.scrollY;
	}
	if (scrollTimeoutId) {
		window.clearTimeout(scrollTimeoutId);
		scrollTimeoutId = 0;
	}
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

function unfreeze(): void {
	if (!frozen) return;
	frozen = false;
	scrolling = false;
	if (scrollTimeoutId) {
		window.clearTimeout(scrollTimeoutId);
		scrollTimeoutId = 0;
	}
	if (typeof window === 'undefined') return;
	const y = window.scrollY;
	lastY = y;
	// Re-sync the header to the landing position (evaluate was skipped while
	// frozen): visible near the top, hidden once scrolled in.
	if (!mobileMq?.matches || y < TOP_THRESHOLD) {
		hidden = false;
		translateY = 0;
	} else {
		hidden = true;
		translateY = -headerHeight;
	}
}

export function getScrollChromeStore(): ScrollChromeStore {
	return {
		get hidden() {
			return hidden;
		},
		get translateY() {
			return translateY;
		},
		get scrolling() {
			return scrolling;
		},
		setHeaderHeight,
		start,
		freeze,
		unfreeze,
		show
	};
}
