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

interface ScrollChromeStore {
	readonly hidden: boolean;
	start: VoidHandler;
	show: VoidHandler;
}

const MOBILE_BREAKPOINT = '(max-width: 767px)';
const TOP_THRESHOLD = 8; // px from top below which chrome always shows
const DIRECTION_THRESHOLD = 4; // net px of movement before toggling visibility

let hidden = $state(false);
let lastY = 0;
let rafId = 0;
let started = false;
let mobileMq: MediaQueryList | null = null;

function evaluate(): void {
	const y = window.scrollY;
	// Off-mobile (desktop): the header is in-flow, never hide.
	if (!mobileMq?.matches) {
		hidden = false;
		lastY = y;
		return;
	}
	const delta = y - lastY;
	lastY = y;
	// Pinned to the top: always show so the chrome does not vanish at rest.
	if (y < TOP_THRESHOLD) {
		hidden = false;
		return;
	}
	if (delta > DIRECTION_THRESHOLD) {
		hidden = true; // scrolling down
	} else if (delta < -DIRECTION_THRESHOLD) {
		hidden = false; // scrolling up
	}
}

function onScroll(): void {
	if (rafId) return;
	rafId = window.requestAnimationFrame(() => {
		rafId = 0;
		evaluate();
	});
}

function onBreakpoint(): void {
	// Crossing back to desktop: ensure the chrome is visible again.
	if (!mobileMq?.matches) hidden = false;
}

function start(): void {
	if (started || typeof window === 'undefined') return;
	started = true;
	mobileMq = window.matchMedia(MOBILE_BREAKPOINT);
	lastY = window.scrollY;
	window.addEventListener('scroll', onScroll, { passive: true });
	mobileMq.addEventListener('change', onBreakpoint);
}

function show(): void {
	hidden = false;
}

export function getScrollChromeStore(): ScrollChromeStore {
	return {
		get hidden() {
			return hidden;
		},
		start,
		show
	};
}
