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
const HORIZONTAL_RATIO = 1.4; // |dx| must exceed |dy| * this to count as horizontal
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

/** Kill the next click (capture phase) so a drag does not double-fire as a tap. */
function suppressNextClick(node: HTMLElement): void {
	const swallow = (event: Event) => {
		event.preventDefault();
		event.stopPropagation();
		node.removeEventListener('click', swallow, true);
	};
	node.addEventListener('click', swallow, true);
}

export const captureSwipe: Action<HTMLElement, SwipeParams> = (node, initial) => {
	let params = initial;
	let pointerId = NO_POINTER;
	let startX = 0;
	let moved = false;
	let active = false;

	function onDown(event: PointerEvent): void {
		if (event.pointerType === 'mouse' || params.disabled?.()) return;
		pointerId = event.pointerId;
		startX = event.clientX;
		moved = false;
		active = true;
		node.setPointerCapture(pointerId);
	}

	function onMove(event: PointerEvent): void {
		if (!active || event.pointerId !== pointerId) return;
		event.preventDefault();
		if (!moved && Math.abs(event.clientX - startX) > CLICK_THRESHOLD) moved = true;
		params.onMove(event.clientX - startX);
	}

	function onUp(event: PointerEvent): void {
		if (!active || event.pointerId !== pointerId) return;
		active = false;
		const delta = event.clientX - startX;
		node.releasePointerCapture(pointerId);
		pointerId = NO_POINTER;
		params.onEnd(delta);
		if (moved) suppressNextClick(node);
	}

	node.style.touchAction = 'none';
	node.addEventListener('pointerdown', onDown);
	node.addEventListener('pointermove', onMove);
	node.addEventListener('pointerup', onUp);
	node.addEventListener('pointercancel', onUp);

	return {
		update(next: SwipeParams): void {
			params = next;
		},
		destroy(): void {
			node.removeEventListener('pointerdown', onDown);
			node.removeEventListener('pointermove', onMove);
			node.removeEventListener('pointerup', onUp);
			node.removeEventListener('pointercancel', onUp);
		}
	};
};

export const detectSwipe: Action<HTMLElement, SwipeParams> = (node, initial) => {
	let params = initial;
	let pointerId = NO_POINTER;
	let startX = 0;
	let startY = 0;
	let startTime = 0;
	let target: EventTarget | null = null;
	let phase: SwipePhase = 'idle';

	function reset(): void {
		phase = 'idle';
		pointerId = NO_POINTER;
	}

	function onDown(event: PointerEvent): void {
		// TEMP DIAGNOSTICS: log the touch position vs the detectSwipe node's
		// bounding rect so we can see WHY the bottom blank doesn't respond.
		const rect = node.getBoundingClientRect();
		const t = event.target as Element | null;
		console.log('[detectSwipe] down', {
			disabled: params.disabled?.(),
			clientY: Math.round(event.clientY),
			nodeTop: Math.round(rect.top),
			nodeBottom: Math.round(rect.bottom),
			nodeH: Math.round(rect.height),
			winH: window.innerHeight,
			docH: document.documentElement.scrollHeight,
			tag: t?.tagName,
			cls: t?.className?.toString().slice(0, 80)
		});
		if (event.pointerType === 'mouse' || params.disabled?.()) return;
		pointerId = event.pointerId;
		startX = event.clientX;
		startY = event.clientY;
		startTime = event.timeStamp;
		target = event.target;
		phase = 'deciding';
	}

	function onMove(event: PointerEvent): void {
		if (phase === 'idle' || phase === 'ignore' || event.pointerId !== pointerId) return;
		const dx = event.clientX - startX;
		const dy = event.clientY - startY;
		if (phase === 'deciding') {
			if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;
			// A gesture that only begins moving after a long-press is selection /
			// context-menu, not a flick - hand it back to the browser untouched.
			if (event.timeStamp - startTime > LONG_PRESS_MS) {
				phase = 'ignore';
				return;
			}
			const horizontal = Math.abs(dx) > Math.abs(dy) * HORIZONTAL_RATIO;
			const ignorable = isInteractive(target) || insideHorizontalScroll(target, node);
			if (horizontal && !ignorable) {
				phase = 'swipe';
				node.setPointerCapture(event.pointerId);
			} else {
				phase = 'ignore';
				return;
			}
		}
		event.preventDefault();
		params.onMove(dx);
	}

	function onUp(event: PointerEvent): void {
		if (event.pointerId !== pointerId) return;
		if (phase === 'swipe') {
			node.releasePointerCapture(event.pointerId);
			params.onEnd(event.clientX - startX);
			suppressNextClick(node);
		}
		reset();
	}

	node.addEventListener('pointerdown', onDown);
	node.addEventListener('pointermove', onMove);
	node.addEventListener('pointerup', onUp);
	node.addEventListener('pointercancel', onUp);

	return {
		update(next: SwipeParams): void {
			params = next;
		},
		destroy(): void {
			node.removeEventListener('pointerdown', onDown);
			node.removeEventListener('pointermove', onMove);
			node.removeEventListener('pointerup', onUp);
			node.removeEventListener('pointercancel', onUp);
		}
	};
};
