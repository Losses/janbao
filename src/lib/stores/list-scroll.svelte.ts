/**
 * List-Scroll Store - remembers the list scroll position so swiping back from a
 * thread overlay to its list (`/` or `/messages/inbox`) lands where you left off.
 *
 * The `(tabs)` layout captures `window.scrollY` in beforeNavigate when leaving a
 * list route for a thread overlay, and restores it SYNCHRONOUSLY in beforeNavigate
 * when returning (before the new route paints) - this covers the browser/OS back
 * button. ThreadPager's swipeEnd does the same restore for the swipe gesture, so
 * the revealed pager is at the right scroll on the first frame (no white frame).
 * `consume()` resets to 0, so whichever caller restores first wins; the other's
 * `y > 0` guard is a no-op.
 */
type CaptureScrollFn = (scrollY: number) => void;
type ConsumeScrollFn = () => number;

interface ListScrollStore {
	capture: CaptureScrollFn;
	consume: ConsumeScrollFn;
	/** The last captured scroll, without resetting. ThreadPager reads this so its
	 * list neighbour previews at the position the committed navigation restores to. */
	readonly captured: number;
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
	return {
		capture,
		consume,
		get captured() {
			return scrollY;
		}
	};
}
