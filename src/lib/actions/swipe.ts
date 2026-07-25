/**
 * Swipe actions - low-level horizontal pointer-drag primitives shared by the
 * mobile drawer (captureSwipe for edge-open + overlay-close) and the pipeline
 * hosts (NavPipelineHost and NavPipelineTabHost via navPipelinePointer, plus
 * SearchScopePager).
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
 * for every pipeline transition (back-swipe, tab-to-tab, deep-to-deep forward,
 * search scope switch). Both actions swallow the synthetic click that follows a
 * real drag so a swipe never double-fires as a tap.
 *
 * The two actions share their pointer-lifecycle plumbing via the internal
 * `createSwipeRuntime` factory: the captured-pointer set, the pointerup /
 * pointercancel / lostpointercapture wiring, the sample + rebound bookkeeping,
 * and the `finish` sequence (delta / velocity / rebound / onEnd /
 * suppressNextClick). Each action supplies only the state and hooks that differ:
 * captureSwipe commits from pointerdown with no intent detection; detectSwipe
 * runs a deciding phase and only commits once a horizontal drag is recognised.
 */
import type { Action } from 'svelte/action';
import { EDGE_DEAD_ZONE } from '$lib/utils/gesture-constants';
import type { VoidHandler } from '$lib/types/handlers';

// `onMove` fires per pointermove with the live displacement only; `onEnd` adds
// `velocity` (release px/ms) and `reversed` (the cancel signal: true when the
// finger rebounded from the drag's peak before lift-off OR when a
// `pointercancel` ended the gesture). `shouldCancelOnRelease` computes this;
// consumers gate commit on `reversed` so a swipe that crossed the commit
// threshold but was pulled back (or was system-interrupted) snaps to the origin
// instead of advancing.
export type MoveHandler = (deltaX: number) => void;
export type EndHandler = (deltaX: number, velocity: number, reversed: boolean) => void;
export type DisabledGetter = () => boolean;
export type ShouldClaimHandler = (dx: number, dy: number) => boolean;

export interface SwipeParams {
	onMove: MoveHandler;
	onEnd: EndHandler;
	disabled?: DisabledGetter;
	/** Consulted in the deciding phase once a drag is horizontal and not
	 *  ignorable. Return false to YIELD: reset to idle without claiming or
	 *  stopping propagation, so the bubbled move reaches an ancestor detectSwipe
	 *  which claims it instead (a nested pager at its boundary hands a leftward
	 *  drag to the enclosing back-swipe surface). Default: always claim. */
	shouldClaim?: ShouldClaimHandler;
	/** When true, call event.stopImmediatePropagation() on every pointermove this
	 *  action CLAIMS - the deciding→swipe transition move AND every steady-state
	 *  swipe move - so an ancestor detectSwipe never re-enters deciding→swipe and
	 *  races to setPointerCapture on the same bubbled touch. pointerup and
	 *  pointercancel are NOT stopped, so the ancestor still receives them and
	 *  resets to idle. */
	exclusive?: boolean;
}

type SwipePhase = 'idle' | 'deciding' | 'swipe' | 'ignore';

const NO_POINTER = -1;
const DEAD_ZONE = 10; // px of travel before a drag is classified
const HORIZONTAL_RATIO = 1.6; // |dx| must exceed |dy| * this to count as horizontal
const LONG_PRESS_MS = 350; // a drag that only starts moving after this is a long-press/select, not a swipe
const CLICK_THRESHOLD = 6; // px of travel before the trailing click is suppressed
// Release-intent detection. `velocity` is the finger's release speed over the
// trailing VELOCITY_WINDOW_MS; `rebound` is how far it pulled back from the
// drag's peak. A change of intent ("dragged past the commit line, then flicked
// back") shows up as rebound, NOT velocity - at lift-off the finger is usually
// already still (velocity ≈ 0), so pure release-speed can't tell "dragged back
// and paused" from "dragged forward and paused". rebound is the primary signal;
// the velocity gate only lets a genuine forward fling (finger still moving
// toward the target) commit despite some trailing rebound.
const VELOCITY_WINDOW_MS = 80;
const REBOUND_CANCEL_PX = 25; // peak→final pullback (px) that cancels a committed release
const FLING_FORWARD_MAX = 0.3; // px/ms; a release faster than this forward still commits
// Only editing controls opt out of swipe detection. Links and buttons do NOT:
// a deliberate horizontal swipe over them should still switch tabs, and the
// trailing click is suppressed separately (suppressNextClick) so a swipe never
// double-fires as a tap. Form fields / the editor / horizontal scrollers keep
// their native behaviour.
function isInteractive(target: EventTarget | null, targetWasFocused: boolean): boolean {
	if (!(target instanceof Element)) return false;
	if (target.closest('[data-gesture-disabled], [data-no-swipe]') !== null) {
		return true;
	}
	const editingAncestor = target.closest('input, textarea, select, [contenteditable]');
	if (editingAncestor !== null) {
		return targetWasFocused;
	}
	return false;
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

interface PositionSample {
	x: number;
	t: number;
}

/**
 * Release velocity (px/ms) over the trailing movement window: positive = finger
 * still moving right at lift-off, negative = moving left. Returns 0 when the
 * window is undersampled (the finger paused before lifting). The window is net
 * displacement over time, so a single jitter sample cannot dominate it.
 */
export function releaseVelocity(samples: PositionSample[]): number {
	const n = samples.length;
	if (n < 2) return 0;
	const last = samples[n - 1];
	const cutoff = last.t - VELOCITY_WINDOW_MS;
	// First sample that still falls inside the trailing window. The bound is n-2
	// (not n-1): we always keep at least the previous sample so there is a span to
	// differentiate, even when an aged outlier is the only earlier point - a
	// 2-sample gesture must not collapse to dt = 0 just because the start sits
	// outside an 80ms window.
	let i = 0;
	while (i < n - 2 && samples[i].t < cutoff) i++;
	const first = samples[i];
	const dt = last.t - first.t;
	if (dt <= 0) return 0;
	return (last.x - first.x) / dt;
}

function recordSample(samples: PositionSample[], x: number, t: number): void {
	samples.push({ x, t });
	if (samples.length > 32) samples.shift();
}

/**
 * True when the user rebounded from the drag's peak before lift-off - crossed
 * the commit threshold but then pulled back, signalling a change of intent.
 * Consumers gate their commit on this so the gesture returns to its origin.
 *
 * `rebound` (peak − final position, px, always ≥ 0) is the primary signal;
 * `velocity` is the px/ms release speed from `releaseVelocity`. At lift-off the
 * finger is usually already still (velocity ≈ 0), so pure release-speed can't
 * distinguish "dragged back and paused" from "dragged forward and paused" -
 * hence rebound leads. The velocity gate only lets a genuine fling (still
 * travelling toward the target at lift-off) commit despite some trailing
 * rebound; it is sign-symmetric so leftward and rightward drags behave alike.
 */
export function reversedAtRelease(deltaX: number, velocity: number, rebound: number): boolean {
	if (deltaX === 0) return false;
	if (rebound < REBOUND_CANCEL_PX) return false;
	const flingingForward =
		Math.sign(velocity) === Math.sign(deltaX) && Math.abs(velocity) >= FLING_FORWARD_MAX;
	return !flingingForward;
}

/** Whether the terminal event should cancel (snap back) instead of committing.
 *  A `pointercancel` is the browser or OS revoking the pointer (a native pan
 *  or OS gesture took over); the user is no longer driving the swipe, so it
 *  must NEVER commit on whatever displacement existed at the instant of
 *  cancellation. Forcing the cancel signal here unifies every consumer (the
 *  pipeline via `navPipelinePointer`, `DualColumnLayout`, and
 *  `SearchScopePager`) on snap-back, so a system-interrupted gesture never
 *  navigates. A genuine `pointerup` cancels only on a rebound. */
export function shouldCancelOnRelease(
	event: PointerEvent,
	deltaX: number,
	velocity: number,
	rebound: number
): boolean {
	return event.type === 'pointercancel' || reversedAtRelease(deltaX, velocity, rebound);
}

/** True while the gesture is in its committing phase: a terminal event in this
 *  state fires onEnd. captureSwipe is active from pointerdown; detectSwipe only
 *  once its deciding→swipe transition fires. */
type SwipeActiveGetter = () => boolean;

/** True when the trailing click after onEnd should be swallowed. captureSwipe
 *  gates this on whether the finger actually travelled past the click
 *  threshold; detectSwipe always suppresses once it has committed. */
type SwipeSuppressClickGetter = () => boolean;

/** Returns the action's current SwipeParams (re-read on every finish so the
 *  runtime always sees the latest `onEnd` after an `update`). */
type SwipeParamsGetter = () => SwipeParams;

/** Action-specific hooks the runtime consults from its shared finish / onUp
 *  sequence. Each action fills these in to express only what differs (the
 *  committing-phase predicate and its cleanup, the abort path for a primary
 *  pointer that lifts mid-deciding, and the click-suppression gate). */
interface SwipeRuntimeHooks {
	isActive: SwipeActiveGetter;
	/** Leave the committing phase. Called from `finish` before `onEnd` fires.
	 *  Must NOT clear `primaryPointerId` (the runtime owns that). */
	deactivate: VoidHandler;
	/** Reset action state when the primary pointer lifts without the gesture
	 *  ever committing (a detectSwipe deciding/ignore abort). No-op for
	 *  captureSwipe, which has no deciding phase. */
	onAbortRelease: VoidHandler;
	shouldSuppressClick: SwipeSuppressClickGetter;
}

/**
 * Shared pointer-lifecycle plumbing for the two swipe actions. Owns the
 * captured-pointer set, the primary-pointer id, the drag's start X / sample
 * window / rebound extremes, and the terminal-event handlers (`finish`,
 * `onUp`, `onLostCapture`) that compute release metrics and drive `onEnd`.
 * Each action binds its own pointerdown / pointermove handlers and delegates
 * only the shared terminal + capture wiring here.
 *
 * Capture is best-effort throughout: each action requests it in its own
 * `onDown` / `onMove` handler so the browser yields native pan / edge-back,
 * but the gesture MUST complete (onEnd) on up / cancel even if capture failed
 * or was lost. `capturedPointers` therefore only gates the release cleanup -
 * never the call to `finish`.
 */
function createSwipeRuntime(
	node: HTMLElement,
	getParams: SwipeParamsGetter,
	hooks: SwipeRuntimeHooks
) {
	const capturedPointers = new Set<number>();
	let primaryPointerId = NO_POINTER;
	let startX = 0;
	let samples: PositionSample[] = [];
	let maxX = 0;
	let minX = 0;

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

	/** Complete the active primary gesture exactly once on the terminal event.
	 *  Computes release metrics from the live-tracked drag extreme (rebound is
	 *  independent of the 32-sample cap, which prunes the early part of long
	 *  drags), forwards them to `onEnd` via `shouldCancelOnRelease`, and
	 *  suppresses the trailing click when the action asks for it. */
	function finish(event: PointerEvent): void {
		if (!hooks.isActive()) return;
		hooks.deactivate();
		primaryPointerId = NO_POINTER;
		const deltaX = event.clientX - startX;
		const velocity = releaseVelocity(samples);
		const rebound = deltaX >= 0 ? maxX - event.clientX : event.clientX - minX;
		getParams().onEnd(deltaX, velocity, shouldCancelOnRelease(event, deltaX, velocity, rebound));
		if (hooks.shouldSuppressClick()) {
			suppressNextClick(node);
		}
	}

	function onUp(event: PointerEvent): void {
		releaseIfHeld(event.pointerId);
		if (event.pointerId !== primaryPointerId) return;
		if (hooks.isActive()) {
			finish(event);
		} else {
			// Primary pointer lifted mid-deciding (detectSwipe) or otherwise
			// without committing: hand the action its abort path. For
			// captureSwipe the hook is a no-op (active and primaryPointerId are
			// always cleared together, so this branch is unreachable in practice).
			hooks.onAbortRelease();
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

	function bindTerminal(): void {
		node.addEventListener('pointerup', onUp);
		node.addEventListener('pointercancel', onUp);
		node.addEventListener('lostpointercapture', onLostCapture);
	}

	function destroy(): void {
		for (const id of capturedPointers) {
			releaseIfHeld(id);
		}
		capturedPointers.clear();
		node.removeEventListener('pointerup', onUp);
		node.removeEventListener('pointercancel', onUp);
		node.removeEventListener('lostpointercapture', onLostCapture);
	}

	return {
		capturedPointers,
		get primaryPointerId() {
			return primaryPointerId;
		},
		set primaryPointerId(value: number) {
			primaryPointerId = value;
		},
		get startX() {
			return startX;
		},
		set startX(value: number) {
			startX = value;
		},
		releaseIfHeld,
		finish,
		onUp,
		onLostCapture,
		resetSamples() {
			samples = [];
		},
		resetBounds(initial: number) {
			maxX = initial;
			minX = initial;
		},
		trackX(x: number) {
			if (x > maxX) maxX = x;
			if (x < minX) minX = x;
		},
		recordSample(x: number, t: number) {
			recordSample(samples, x, t);
		},
		bindTerminal,
		destroy
	};
}

export const captureSwipe: Action<HTMLElement, SwipeParams> = (node, initial) => {
	let params = initial;
	// `moved` tracks whether the finger actually travelled past the click
	// threshold: captureSwipe only suppresses the trailing click for a real drag,
	// not a stationary press.
	let active = false;
	let moved = false;

	const runtime = createSwipeRuntime(node, () => params, {
		isActive: () => active,
		deactivate: () => {
			active = false;
		},
		onAbortRelease: () => {
			// No deciding phase; active and primaryPointerId are cleared together
			// in finish, so a non-committing primary release is unreachable here.
		},
		shouldSuppressClick: () => moved
	});

	function onDown(event: PointerEvent): void {
		if (event.pointerType === 'mouse' || params.disabled?.()) {
			return;
		}

		const id = event.pointerId;
		if (runtime.primaryPointerId === NO_POINTER) {
			runtime.primaryPointerId = id;
			runtime.startX = event.clientX;
			runtime.resetBounds(event.clientX);
			moved = false;
			active = true;
			runtime.resetSamples();
		}

		try {
			node.setPointerCapture(id);
			runtime.capturedPointers.add(id);
		} catch {
			// Capture is optional; the gesture still completes on up / cancel.
		}
	}

	function onMove(event: PointerEvent): void {
		if (event.pointerId !== runtime.primaryPointerId || !active) return;
		event.preventDefault();
		const delta = event.clientX - runtime.startX;
		if (!moved && Math.abs(delta) > CLICK_THRESHOLD) {
			moved = true;
		}
		runtime.trackX(event.clientX);
		runtime.recordSample(event.clientX, event.timeStamp);
		params.onMove(delta);
	}

	node.style.touchAction = 'none';
	node.addEventListener('pointerdown', onDown);
	node.addEventListener('pointermove', onMove);
	runtime.bindTerminal();

	return {
		update(next: SwipeParams): void {
			params = next;
		},
		destroy(): void {
			node.removeEventListener('pointerdown', onDown);
			node.removeEventListener('pointermove', onMove);
			runtime.destroy();
		}
	};
};

export const detectSwipe: Action<HTMLElement, SwipeParams> = (node, initial) => {
	let params = initial;
	let startY = 0;
	let startTime = 0;
	let target: EventTarget | null = null;
	let targetWasFocused = false;
	let phase: SwipePhase = 'idle';

	const runtime = createSwipeRuntime(node, () => params, {
		isActive: () => phase === 'swipe',
		deactivate: () => {
			phase = 'idle';
		},
		onAbortRelease: () => {
			reset();
		},
		shouldSuppressClick: () => true
	});

	function reset(): void {
		phase = 'idle';
		runtime.primaryPointerId = NO_POINTER;
	}

	function onDown(event: PointerEvent): void {
		if (event.pointerType === 'mouse' || params.disabled?.()) {
			return;
		}
		// Only a fresh gesture (from idle) can begin tracking. A second finger while
		// one is in flight, and an edge-dead-zone reject, must leave phase untouched -
		// a dead-zone pointer is never assigned primaryPointerId, so mutating phase
		// here would strand it in 'ignore' and kill every later swipe until reload.
		if (phase !== 'idle') {
			return;
		}

		// OS edge-swipe collision guard: reject a pointer in the edge
		// gutter (EDGE_DEAD_ZONE px) so the app's back-swipe does not
		// collide with the OS edge-back gesture. Shared with the
		// pipeline pointer-bridge's capture listener (which mirrors this
		// exact check; both mobile hosts mount it).
		if (event.clientX < EDGE_DEAD_ZONE || event.clientX > window.innerWidth - EDGE_DEAD_ZONE) {
			return;
		}

		runtime.primaryPointerId = event.pointerId;
		runtime.startX = event.clientX;
		startY = event.clientY;
		startTime = event.timeStamp;
		target = event.target;
		runtime.resetSamples();
		runtime.resetBounds(event.clientX);

		const editingAncestor =
			target instanceof Element
				? target.closest('input, textarea, select, [contenteditable]')
				: null;
		targetWasFocused =
			editingAncestor !== null &&
			document.activeElement !== null &&
			(document.activeElement === editingAncestor ||
				editingAncestor.contains(document.activeElement));

		phase = 'deciding';
	}

	function onMove(event: PointerEvent): void {
		if (event.pointerId !== runtime.primaryPointerId) return;
		if (phase === 'idle' || phase === 'ignore') return;
		const dx = event.clientX - runtime.startX;
		const dy = event.clientY - startY;
		// Track the drag's extreme on every move (incl. while still deciding) so
		// rebound reflects the true peak even when the deciding phase travels.
		runtime.trackX(event.clientX);
		if (phase === 'deciding') {
			const absDx = Math.abs(dx);
			const absDy = Math.abs(dy);
			if (absDx < DEAD_ZONE && absDy < DEAD_ZONE) return;
			// A gesture that only begins moving after a long-press is selection /
			// context-menu, not a flick - hand it back to the browser untouched.
			if (event.timeStamp - startTime > LONG_PRESS_MS) {
				phase = 'ignore';
				return;
			}

			const horizontal = absDx > absDy * HORIZONTAL_RATIO;
			const vertical = absDy > absDx * HORIZONTAL_RATIO;
			const ignorable =
				isInteractive(target, targetWasFocused) || insideHorizontalScroll(target, node);

			if (absDx >= DEAD_ZONE && horizontal) {
				if (!ignorable) {
					if (params.shouldClaim && !params.shouldClaim(dx, dy)) {
						// Yield: no neighbour exists in this drag direction (a nested
						// pager at its boundary). Reset to idle WITHOUT claiming or
						// stopping propagation so the move bubbles on to an ancestor
						// detectSwipe, which claims it instead.
						reset();
						return;
					}
					phase = 'swipe';
					try {
						node.setPointerCapture(event.pointerId);
						runtime.capturedPointers.add(event.pointerId);
					} catch {
						// Capture is best-effort: a failure (pointer already released) just means the gesture proceeds without capture.
					}
				} else {
					phase = 'ignore';
					return;
				}
			} else if (absDy >= DEAD_ZONE && vertical) {
				phase = 'ignore';
				return;
			} else if (absDx > 25 || absDy > 25) {
				phase = 'ignore';
				return;
			} else {
				// Keep deciding (both are small, or ratio is close)
				return;
			}
		}
		event.preventDefault();
		if (params.exclusive) {
			// Shield ancestor detectSwipe instances from this claimed move.
			// stopImmediatePropagation is per-event, so calling it only at the claim
			// moment is not enough: subsequent steady-state moves would still bubble
			// to an ancestor stuck in 'deciding' and re-trigger the setPointerCapture
			// race. Apply it on every swipe-phase move. pointerup/pointercancel are
			// handled by onUp (not stopped) so the ancestor still receives them.
			event.stopImmediatePropagation();
		}
		runtime.recordSample(event.clientX, event.timeStamp);
		params.onMove(dx);
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
				const dx = touch.clientX - runtime.startX;
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
	runtime.bindTerminal();
	node.addEventListener('touchmove', preventTouchMove, { passive: false });

	return {
		update(next: SwipeParams): void {
			params = next;
		},
		destroy(): void {
			node.removeEventListener('pointerdown', onDown);
			node.removeEventListener('pointermove', onMove);
			node.removeEventListener('touchmove', preventTouchMove);
			runtime.destroy();
		}
	};
};
