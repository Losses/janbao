/**
 * List-Scroll Store - remembers the discussions-list scroll position so swiping
 * back from a discussion thread to `/` lands where you left off.
 *
 * The `(tabs)` layout captures `window.scrollY` in beforeNavigate when leaving
 * `/` for a `/discussion/*` thread, and consumes/restores it in afterNavigate
 * when returning to `/`. The ThreadPager's left neighbour also peeks `captured`
 * (without resetting) so its swipe reveal previews the list at that same scroll
 * instead of from the top - otherwise the reveal and the restore disagree and
 * the list jumps on commit.
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
