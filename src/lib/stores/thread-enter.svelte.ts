/**
 * Thread-Enter Direction - a one-shot flag set by the root layout's
 * beforeNavigate when a navigation goes from `/` (the discussions list) to a
 * `/discussion/*` thread. ThreadPager consumes it on mount to play a forward
 * slide-in (push) transition - the list neighbour slides out as the thread
 * slides in - mirroring the existing back-swipe, instead of the thread
 * appearing static.
 *
 * Module-level (NOT reactive): it is written once per navigation in
 * beforeNavigate and read once on ThreadPager mount, then reset. SSR never
 * navigates, so it stays false server-side.
 */
let enterFromList = false;

export function markEnterFromList(): void {
	enterFromList = true;
}

export function consumeEnterFromList(): boolean {
	const value = enterFromList;
	enterFromList = false;
	return value;
}
