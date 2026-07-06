// src/lib/actions/nav-pipeline-pointer.ts
/**
 * The 5b1 pilot pointer bridge. A Svelte action that wraps the existing
 * `detectSwipe` primitive (so the edge-dead-zone, horizontal-ratio
 * classification, and rebound logic are byte-stable with every other
 * route's gesture detection) and forwards pointer events to the
 * orchestrator's intent classifier.
 *
 * Per the C05b1 spec's binding "UNIFY, DO NOT BRIDGE" constraint: this
 * action does NOT own animation or navigation. It is gesture DETECTION
 * only - it converts pointer events into `(deltaX, velocity, reversed)`
 * callbacks (the same surface `detectSwipe` exposes to GesturePageLayout
 * on non-pilot routes) and forwards them to the orchestrator. The
 * orchestrator runs the resolver + executor + driver; the executor
 * drives the rAF that writes the track transform. There is no CSS
 * transition, no `transitionend`, no `pendingNav` rAF-poll on this
 * action's surface.
 *
 * `disabled` is gated so non-pilot routes never activate this bridge
 * (non-pilot routes keep their existing `GesturePageLayout` gesture
 * path, untouched in 5b1). The action is only mounted on the pilot's
 * `NavPipelineHost` viewport element.
 */
import type { Action } from 'svelte/action';
import { detectSwipe, type EndHandler, type MoveHandler } from './swipe';
import type { NavPipelineOrchestrator } from '$lib/stores/nav-pipeline-orchestrator.svelte';

/** True when the bridge should be inert (desktop, or the host not yet
 *  mounted). The `detectSwipe` action's own `disabled` getter also
 *  reads this so the underlying pointer listeners short-circuit. */
export type PointerDisabledGetter = () => boolean;

/** Constructor params for the action. */
export interface NavPipelinePointerParams {
	/** The active orchestrator. The action forwards classified pointer
	 *  events to its `onPointerDown` / `onPointerMove` / `onPointerUp`
	 *  boundary methods. */
	readonly orchestrator: NavPipelineOrchestrator;
	/** True when the bridge should be inert (desktop, or the host not
	 *  yet mounted). The `detectSwipe` action's own `disabled` getter
	 *  also reads this so the underlying pointer listeners short-circuit. */
	readonly disabled: PointerDisabledGetter;
}

/** The current pointer context. The orchestrator's classifier takes
 *  absolute X (not deltas); the action reconstructs it from the
 *  pointerdown's start X + the running delta. */
interface PointerContext {
	readonly startX: number;
	readonly startY: number;
	readonly target: string | null;
}

/** Returns the current pointer context, or null when no gesture is in
 *  flight. */
type PointerContextGetter = () => PointerContext | null;

/** The move / end handlers `detectSwipe` calls back. Each handler
 *  reconstructs the absolute pointer X (the classifier takes absolute
 *  X, not deltas) and forwards the equivalent IntentEvent to the
 *  orchestrator. */
interface SwipeHandlerPair {
	readonly onMove: MoveHandler;
	readonly onEnd: EndHandler;
}

/** Build the move / end handlers `detectSwipe` calls. Each handler
 *  reconstructs the absolute pointer X (the classifier takes absolute
 *  X, not deltas) and forwards the equivalent IntentEvent to the
 *  orchestrator. */
function buildHandlers(
	orchestrator: NavPipelineOrchestrator,
	ctx: PointerContextGetter
): SwipeHandlerPair {
	const onMove: MoveHandler = (deltaX: number): void => {
		const c = ctx();
		if (c === null) return;
		const x = c.startX + deltaX;
		orchestrator.onPointerMove(x, c.startY);
	};
	const onEnd: EndHandler = (deltaX: number): void => {
		const c = ctx();
		if (c === null) return;
		const x = c.startX + deltaX;
		orchestrator.onPointerUp(x, c.startY);
	};
	return { onMove, onEnd };
}

/** Capture the target's distinguishing identifier (the data attributes
 *  the classifier might consult). Returns null when the target is not
 *  an Element. */
function describeTarget(target: EventTarget | null): string | null {
	if (!(target instanceof Element)) return null;
	const tabNav = target.closest('[data-tab-nav]');
	if (tabNav !== null) return tabNav.getAttribute('href');
	return null;
}

/** The Svelte action. Attaches `detectSwipe` with handlers that bridge
 *  to the orchestrator's intent classifier; tracks the pointer context
 *  (start X/Y + target) across the gesture. */
export const navPipelinePointer: Action<HTMLElement, NavPipelinePointerParams> = (
	node,
	initial
) => {
	let params = initial;
	let ctx: PointerContext | null = null;
	let lastDownX = 0;
	let lastDownY = 0;
	let lastDownTarget: string | null = null;

	const onMove: MoveHandler = (deltaX: number): void => {
		if (ctx === null) {
			ctx = {
				startX: lastDownX,
				startY: lastDownY,
				target: lastDownTarget
			};
			// The first move classified as a swipe: forward the equivalent
			// pointerdown + pointermove so the classifier enters the drag
			// state. The orchestrator's classifier takes absolute X.
			params.orchestrator.onPointerDown(lastDownX, lastDownY, lastDownTarget);
			const x = lastDownX + deltaX;
			params.orchestrator.onPointerMove(x, lastDownY);
			return;
		}
		const x = ctx.startX + deltaX;
		params.orchestrator.onPointerMove(x, ctx.startY);
	};

	const onEnd: EndHandler = (deltaX: number): void => {
		const c = ctx;
		ctx = null;
		if (c === null) {
			// The gesture ended without a single onMove (a tap). The
			// classifier never entered the drag state; no further action.
			return;
		}
		const x = c.startX + deltaX;
		params.orchestrator.onPointerUp(x, c.startY);
	};

	// Pre-bind a pointerdown listener so the action sees the absolute
	// pointer X at gesture start (the underlying detectSwipe callbacks
	// are delta-only). Capture-phase so we run before any ancestor
	// handler.
	const onPointerDownCapture = (event: PointerEvent): void => {
		if (params.disabled()) return;
		if (event.pointerType === 'mouse') return;
		lastDownX = event.clientX;
		lastDownY = event.clientY;
		lastDownTarget = describeTarget(event.target);
		ctx = null;
	};

	node.addEventListener('pointerdown', onPointerDownCapture, true);

	const swipeParams = {
		onMove,
		onEnd,
		disabled: () => params.disabled()
	};
	const swipe = detectSwipe(node, swipeParams);

	return {
		update(next: NavPipelinePointerParams): void {
			params = next;
			if (swipe && typeof swipe.update === 'function') {
				swipe.update({
					onMove,
					onEnd,
					disabled: () => params.disabled()
				});
			}
		},
		destroy(): void {
			node.removeEventListener('pointerdown', onPointerDownCapture, true);
			if (swipe && typeof swipe.destroy === 'function') {
				swipe.destroy();
			}
		}
	};
};

// Helper exports for tests that want to drive the handler shape
// directly without the Svelte action machinery.
export { buildHandlers, describeTarget };
