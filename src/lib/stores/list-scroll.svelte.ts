/**
 * List-Scroll Store - remembers the discussions-list scroll position so that
 * swiping back from a discussion thread to `/` lands where you left off.
 *
 * The `(tabs)` layout captures `window.scrollY` in beforeNavigate when leaving
 * `/` for a `/discussion/*` thread, and consumes/restores it in afterNavigate
 * when returning to `/`. SvelteKit's built-in scroll restoration already covers
 * browser back/forward; this covers the programmatic swipe-back `goto('/')`.
 */
type CaptureScrollFn = (scrollY: number) => void;
type ConsumeScrollFn = () => number;

interface ListScrollStore {
	capture: CaptureScrollFn;
	consume: ConsumeScrollFn;
}

let scrollY = $state(0);

function capture(y: number): void {
	scrollY = y;
}
function consume(): number {
	const y = scrollY;
	scrollY = 0;
	return y;
}

export function getListScrollStore(): ListScrollStore {
	return { capture, consume };
}
