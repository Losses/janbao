/**
 * Swipe actions - low-level horizontal pointer-drag primitives shared by the
 * mobile drawer (edge-open + overlay-close) and the tab pager.
 *
 * `captureSwipe` claims the entire gesture: touch-action:none on the node so
 * the browser yields its built-in pan / zoom / edge-back to us, pointer capture
 * from pointerdown, and preventDefault on move. Used on surfaces with no
 * competing native behaviour to preserve (the left edge zone + drawer overlay).
 *
 * `detectSwipe` runs on a surface that scrolls vertically (the pager viewport):
 * it leaves native vertical scroll untouched and only takes over once a
 * clearly-horizontal drag is recognised (intent detection), ignoring drags that
 * start on editing controls or inside a horizontally-scrollable container. Used
 * for left/right tab switching. Both actions swallow the synthetic click that
 * follows a real drag so a swipe never double-fires as a tap.
 */
import type { Action } from 'svelte/action';

export type DeltaHandler = (deltaX: number) => void;
export type DisabledGetter = () => boolean;

export interface SwipeParams {
	onMove: DeltaHandler;
	onEnd: DeltaHandler;
	disabled?: DisabledGetter;
}

type SwipePhase = 'idle' | 'deciding' | 'swipe' | 'ignore';

const NO_POINTER = -1;
const DEAD_ZONE = 10; // px of travel before a drag is classified
const HORIZONTAL_RATIO = 1.6; // |dx| must exceed |dy| * this to count as horizontal
const LONG_PRESS_MS = 350; // a drag that only starts moving after this is a long-press/select, not a swipe
const CLICK_THRESHOLD = 6; // px of travel before the trailing click is suppressed
// Only editing controls opt out of swipe detection. Links and buttons do NOT:
// a deliberate horizontal swipe over them should still switch tabs, and the
// trailing click is suppressed separately (suppressNextClick) so a swipe never
// double-fires as a tap. Form fields / the editor / horizontal scrollers keep
// their native behaviour.
const INTERACTIVE_SELECTOR = 'input, textarea, select, [contenteditable], [data-no-swipe]';

function isInteractive(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false;
	return target.closest(INTERACTIVE_SELECTOR) !== null;
}

/** Walk up from the target; bail if any ancestor up to `boundary` scrolls horizontally. */
function insideHorizontalScroll(target: EventTarget | null, boundary: HTMLElement): boolean {
	let node: Element | null = target instanceof Element ? target : null;
	while (node && node !== boundary) {
		const style = getComputedStyle(node);
		const scrollsX = style.overflowX === 'auto' || style.overflowX === 'scroll';
		if (scrollsX && node.scrollWidth > node.clientWidth + 1) return true;
		node = node.parentElement;
	}
	return false;
}

/**
 * Suppress the next click so a drag does not double-fire as a tap. If the
 * browser generates a click after the drag, `swallow` catches it and cleans
 * up. If it does NOT (pointer-capture drags skip click generation), the next
 * `pointerdown` - the start of the user's next tap - cleans up the lingering
 * listener so that tap's click goes through. A 400ms safety timer acts as a
 * fallback cleanup in case pointerdown or click event flow is interrupted or bypassed.
 */
function suppressNextClick(node: HTMLElement): void {
	let timerId: number | null = null;
	const swallow = (event: Event) => {
		event.preventDefault();
		event.stopPropagation();
		cleanup();
	};
	const onNextDown = () => {
		cleanup();
	};
	const cleanup = () => {
		if (timerId !== null) {
			clearTimeout(timerId);
			timerId = null;
		}
		node.removeEventListener('click', swallow, true);
		window.removeEventListener('pointerdown', onNextDown, { capture: true });
	};
	node.addEventListener('click', swallow, true);
	window.addEventListener('pointerdown', onNextDown, { capture: true });
	timerId = window.setTimeout(() => {
		cleanup();
	}, 400);
}

export const captureSwipe: Action<HTMLElement, SwipeParams> = (node, initial) => {
	let params = initial;
	// Capture is best-effort: we request it so the browser yields native pan /
	// edge-back to us, but the gesture MUST complete (onEnd) on up / cancel even
	// if capture failed or was lost. `capturedPointers` therefore only gates the
	// release cleanup - never the call to `finish`.
	const capturedPointers = new Set<number>();
	let startX = 0;
	let moved = false;
	let active = false;
	let primaryPointerId = NO_POINTER;

	function releaseIfHeld(id: number): void {
		if (!capturedPointers.has(id)) return;
		try {
			if (node.hasPointerCapture(id)) {
				node.releasePointerCapture(id);
			}
		} catch {
			// Ignore release failure
		}
		capturedPointers.delete(id);
	}

	/** Complete the active primary gesture exactly once on the terminal event. */
	function finish(event: PointerEvent): void {
		if (!active) return;
		active = false;
		primaryPointerId = NO_POINTER;
		params.onEnd(event.clientX - startX);
		if (moved) suppressNextClick(node);
	}

	function onDown(event: PointerEvent): void {
		if (event.pointerType === 'mouse' || params.disabled?.()) {
			return;
		}

		const id = event.pointerId;
		if (primaryPointerId === NO_POINTER) {
			primaryPointerId = id;
			startX = event.clientX;
			moved = false;
			active = true;
		}

		try {
			node.setPointerCapture(id);
			capturedPointers.add(id);
		} catch {
			// Capture is optional; the gesture still completes on up / cancel.
		}
	}

	function onMove(event: PointerEvent): void {
		if (event.pointerId !== primaryPointerId || !active) return;
		event.preventDefault();
		const delta = event.clientX - startX;
		if (!moved && Math.abs(delta) > CLICK_THRESHOLD) {
			moved = true;
		}
		params.onMove(delta);
	}

	// In captureSwipe we also block body elastic bounce when dragging the edge
	function onUp(event: PointerEvent): void {
		releaseIfHeld(event.pointerId);
		if (event.pointerId === primaryPointerId) {
			finish(event);
		}
	}

	function onLostCapture(event: PointerEvent): void {
		// Pointer capture was released (by us on up, or by the browser). Losing
		// capture does NOT end the gesture: after release, pointer events resume
		// normal hit-testing and - with the finger still over this node - the real
		// pointerup / pointercancel still arrives and completes the gesture via
		// onUp. Finishing here would snap on a stale delta, so we only keep the
		// capture set accurate for destroy() and leave gesture state untouched.
		capturedPointers.delete(event.pointerId);
	}

	node.style.touchAction = 'none';
	node.addEventListener('pointerdown', onDown);
	node.addEventListener('pointermove', onMove);
	node.addEventListener('pointerup', onUp);
	node.addEventListener('pointercancel', onUp);
	node.addEventListener('lostpointercapture', onLostCapture);

	return {
		update(next: SwipeParams): void {
			params = next;
		},
		destroy(): void {
			for (const id of capturedPointers) {
				releaseIfHeld(id);
			}
			capturedPointers.clear();
			node.removeEventListener('pointerdown', onDown);
			node.removeEventListener('pointermove', onMove);
			node.removeEventListener('pointerup', onUp);
			node.removeEventListener('pointercancel', onUp);
			node.removeEventListener('lostpointercapture', onLostCapture);
		}
	};
};

export const detectSwipe: Action<HTMLElement, SwipeParams> = (node, initial) => {
	let params = initial;
	// See captureSwipe: capture is best-effort. A recognised swipe MUST fire onEnd
	// on up / cancel regardless of capture state, otherwise the pager / tab-slide
	// animation freezes mid-transition.
	const capturedPointers = new Set<number>();
	let startX = 0;
	let startY = 0;
	let startTime = 0;
	let target: EventTarget | null = null;
	let phase: SwipePhase = 'idle';
	let primaryPointerId = NO_POINTER;

	function releaseIfHeld(id: number): void {
		if (!capturedPointers.has(id)) return;
		try {
			if (node.hasPointerCapture(id)) {
				node.releasePointerCapture(id);
			}
		} catch {
			// Ignore release failure
		}
		capturedPointers.delete(id);
	}

	/** Fire onEnd for an in-flight swipe exactly once on the terminal event. */
	function finish(event: PointerEvent): void {
		if (phase !== 'swipe') return;
		phase = 'idle';
		primaryPointerId = NO_POINTER;
		params.onEnd(event.clientX - startX);
		suppressNextClick(node);
	}

	function reset(): void {
		phase = 'idle';
		primaryPointerId = NO_POINTER;
	}

	function onDown(event: PointerEvent): void {
		if (event.pointerType === 'mouse' || params.disabled?.()) {
			return;
		}

		// OS edge-swipe gesture collision guard (40px margin zone to match modern iOS/Android bezel-less native triggers)
		const edgeDeadZone = 40;
		if (event.clientX < edgeDeadZone || event.clientX > window.innerWidth - edgeDeadZone) {
			console.log('[detectSwipe] ignored due to edge dead zone:', event.clientX);
			phase = 'ignore';
			return;
		}

		if (phase === 'idle') {
			primaryPointerId = event.pointerId;
			startX = event.clientX;
			startY = event.clientY;
			startTime = event.timeStamp;
			target = event.target;
			phase = 'deciding';
			console.log('[detectSwipe] down start:', { startX, startY, phase });
		}
	}

	function onMove(event: PointerEvent): void {
		if (event.pointerId !== primaryPointerId) return;
		if (phase === 'idle' || phase === 'ignore') return;
		const dx = event.clientX - startX;
		const dy = event.clientY - startY;
		if (phase === 'deciding') {
			const absDx = Math.abs(dx);
			const absDy = Math.abs(dy);
			if (absDx < DEAD_ZONE && absDy < DEAD_ZONE) return;
			// A gesture that only begins moving after a long-press is selection /
			// context-menu, not a flick - hand it back to the browser untouched.
			if (event.timeStamp - startTime > LONG_PRESS_MS) {
				console.log('[detectSwipe] ignored due to long press time:', event.timeStamp - startTime);
				phase = 'ignore';
				return;
			}

			const horizontal = absDx > absDy * HORIZONTAL_RATIO;
			const vertical = absDy > absDx * HORIZONTAL_RATIO;
			const ignorable = isInteractive(target) || insideHorizontalScroll(target, node);

			console.log('[detectSwipe] deciding progress:', {
				dx,
				dy,
				absDx,
				absDy,
				horizontal,
				vertical,
				ignorable
			});

			if (absDx >= DEAD_ZONE && horizontal) {
				if (!ignorable) {
					phase = 'swipe';
					console.log('[detectSwipe] swipe activated!');
					try {
						node.setPointerCapture(event.pointerId);
						capturedPointers.add(event.pointerId);
					} catch (err) {
						console.log('[detectSwipe] pointer capture failed:', err);
					}
				} else {
					console.log('[detectSwipe] ignored because interactive/scrollable:', { ignorable });
					phase = 'ignore';
					return;
				}
			} else if (absDy >= DEAD_ZONE && vertical) {
				console.log('[detectSwipe] vertical scroll detected, ignoring swipe');
				phase = 'ignore';
				return;
			} else if (absDx > 25 || absDy > 25) {
				console.log('[detectSwipe] ambiguous drag exceeded safety limit, ignoring');
				phase = 'ignore';
				return;
			} else {
				// Keep deciding (both are small, or ratio is close)
				console.log('[detectSwipe] ambiguous diagonal movement under limit, continue deciding...');
				return;
			}
		}
		event.preventDefault();
		params.onMove(dx);
	}

	function onUp(event: PointerEvent): void {
		releaseIfHeld(event.pointerId);
		if (event.pointerId !== primaryPointerId) return;
		console.log('[detectSwipe] up/cancel event:', { phase, deltaX: event.clientX - startX });
		if (phase === 'swipe') {
			finish(event);
		} else {
			reset();
		}
	}

	function onLostCapture(event: PointerEvent): void {
		// See captureSwipe.onLostCapture: losing capture does not end the gesture.
		// The real pointerup / pointercancel still arrives and completes the swipe
		// via onUp, so only sync the capture set; never snap from here (doing so
		// sprang the pager back on a mid-swipe lostpointercapture).
		capturedPointers.delete(event.pointerId);
	}

	// Intercept touchmove events to lock vertical scroll when horizontal swipe is active
	function preventTouchMove(event: TouchEvent) {
		if (phase === 'swipe') {
			if (event.cancelable) {
				event.preventDefault();
			}
		} else if (phase === 'deciding') {
			const touch = event.touches[0];
			if (touch) {
				const dx = touch.clientX - startX;
				const dy = touch.clientY - startY;
				// If horizontal movement is dominant, prevent default early (even before DEAD_ZONE)
				// to lock vertical scrolling and prevent the browser from claiming the gesture.
				const horizontal = Math.abs(dx) > Math.abs(dy) * 1.1;
				if (horizontal && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
					if (event.cancelable) {
						event.preventDefault();
					}
				}
			}
		}
	}

	node.addEventListener('pointerdown', onDown);
	node.addEventListener('pointermove', onMove);
	node.addEventListener('pointerup', onUp);
	node.addEventListener('pointercancel', onUp);
	node.addEventListener('lostpointercapture', onLostCapture);
	node.addEventListener('touchmove', preventTouchMove, { passive: false });

	return {
		update(next: SwipeParams): void {
			params = next;
		},
		destroy(): void {
			for (const id of capturedPointers) {
				releaseIfHeld(id);
			}
			capturedPointers.clear();
			node.removeEventListener('pointerdown', onDown);
			node.removeEventListener('pointermove', onMove);
			node.removeEventListener('pointerup', onUp);
			node.removeEventListener('pointercancel', onUp);
			node.removeEventListener('lostpointercapture', onLostCapture);
			node.removeEventListener('touchmove', preventTouchMove);
		}
	};
};
