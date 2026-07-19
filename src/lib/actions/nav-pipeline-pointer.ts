// src/lib/actions/nav-pipeline-pointer.ts
/**
 * The pipeline pointer bridge. A Svelte action that wraps the
 * `detectSwipe` primitive (so the edge-dead-zone, horizontal-ratio
 * classification, and rebound logic stay byte-stable) and forwards
 * pointer events to the orchestrator's intent classifier.
 *
 * Per the binding "UNIFY, DO NOT BRIDGE" constraint: this action does
 * NOT own animation or navigation. It is gesture DETECTION only: it
 * converts pointer events into `(deltaX, velocity, reversed)` callbacks
 * and forwards them to the orchestrator. The orchestrator runs the
 * resolver + executor + driver; the executor drives the rAF that
 * writes the track transform. There is no CSS transition and no
 * `transitionend` handler on this action's surface.
 *
 * Mounted on the viewport element of both pipeline hosts
 * (`NavPipelineHost` and `NavPipelineTabHost`).
 */
import type { Action } from 'svelte/action';
import { detectSwipe, type EndHandler, type MoveHandler } from './swipe';
import type { NavPipelineOrchestrator } from '$lib/stores/nav-pipeline-orchestrator.svelte';
import { EDGE_DEAD_ZONE } from '$lib/utils/gesture-constants';

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
}

/** The Svelte action. Attaches `detectSwipe` with handlers that bridge
 *  to the orchestrator's intent classifier; tracks the pointer context
 *  (start X/Y) across the gesture. */
export const navPipelinePointer: Action<HTMLElement, NavPipelinePointerParams> = (
	node,
	initial
) => {
	let params = initial;
	let ctx: PointerContext | null = null;
	let lastDownX = 0;
	let lastDownY = 0;
	// §9: single-gesture at a time. The primary pointer owns the gesture
	// once its pointerdown is recorded; secondary pointerdowns are ignored
	// until the primary is released.
	let primaryPointerId: number | null = null;

	const onMove: MoveHandler = (deltaX: number): void => {
		if (ctx === null) {
			ctx = {
				startX: lastDownX,
				startY: lastDownY
			};
			// The first move classified as a swipe: forward the equivalent
			// pointerdown + pointermove so the classifier enters the drag
			// state. The orchestrator's classifier takes absolute X.
			params.orchestrator.onPointerDown(lastDownX, lastDownY);
			const x = lastDownX + deltaX;
			params.orchestrator.onPointerMove(x, lastDownY);
			return;
		}
		const x = ctx.startX + deltaX;
		params.orchestrator.onPointerMove(x, ctx.startY);
	};

	const onEnd: EndHandler = (deltaX: number, velocity: number, reversed: boolean): void => {
		const c = ctx;
		ctx = null;
		if (c === null) {
			// The gesture ended without a single onMove (a tap). The
			// classifier never entered the drag state; no further action.
			return;
		}
		const x = c.startX + deltaX;
		// Forward detectSwipe's rebound-based `reversed` and
		// trailing-window `velocity` to the orchestrator. These are
		// the authoritative release signals (detectSwipe tracks the
		// peak vs final position for rebound and a precise trailing
		// sample window for velocity); the orchestrator uses them to
		// override the classifier's own estimates so the release gate
		// matches the non-pipeline routes' commit/cancel decision.
		params.orchestrator.onPointerUp(x, c.startY, velocity, reversed);
	};

	// Pre-bind a pointerdown listener so the action sees the absolute
	// pointer X at gesture start (the underlying detectSwipe callbacks
	// are delta-only). Capture-phase so we run before any ancestor
	// handler.
	const onPointerDownCapture = (event: PointerEvent): void => {
		if (params.disabled()) return;
		if (event.pointerType === 'mouse') return;
		// Mirror detectSwipe's EXACT edge check (40 px, < / >,
		// window.innerWidth) so the capture records as primary only a
		// pointer detectSwipe will claim. All three edge checks -
		// detectSwipe and this capture read `EDGE_DEAD_ZONE` from
		// `gesture-constants.ts`; the classifier's `isEdgeReserve` reads
		// `DEFAULT_EDGE_DEAD_ZONE` from `nav-intent.ts`. They agree at the
		// value 40 with the same strict operators, but the two constants
		// are separately defined - changing one requires changing the
		// other.
		if (event.clientX < EDGE_DEAD_ZONE || event.clientX > window.innerWidth - EDGE_DEAD_ZONE) {
			return;
		}
		// Ignore a secondary pointer once a primary owns the gesture, so
		// it cannot overwrite the start position or reset the context.
		if (primaryPointerId !== null && event.pointerId !== primaryPointerId) return;
		primaryPointerId = event.pointerId;
		lastDownX = event.clientX;
		lastDownY = event.clientY;
		ctx = null;
	};
	const onPointerUpCapture = (event: PointerEvent): void => {
		if (event.pointerId === primaryPointerId) primaryPointerId = null;
	};

	node.addEventListener('pointerdown', onPointerDownCapture, true);
	node.addEventListener('pointerup', onPointerUpCapture, true);
	node.addEventListener('pointercancel', onPointerUpCapture, true);

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
			node.removeEventListener('pointerup', onPointerUpCapture, true);
			node.removeEventListener('pointercancel', onPointerUpCapture, true);
			if (swipe && typeof swipe.destroy === 'function') {
				swipe.destroy();
			}
		}
	};
};
