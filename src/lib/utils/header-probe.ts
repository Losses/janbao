/**
 * DEV-ONLY Header morph-state probe sink.
 *
 * Header.svelte pushes a per-flush snapshot of its tab-morph state machine
 * (morph / slideT / settling / navInFlight / ...) to window.__headerMorphProbe on every
 * reactive flush (gated on DEV + browser, so it never ships). An e2e sampler
 * reads the log to correlate a tabs-layer jump with the exact derived values
 * that produced it. The per-flush cadence is paint-independent: it captures the
 * commit flush even when the navigation blocks the main thread between paints
 * (where a rAF sampler drops frames).
 *
 * The Window augmentation lives in this standalone module (not in Header.svelte)
 * because a Svelte component's `<script>` compiles into a function body, where a
 * top-level `declare global` is rejected by svelte-check.
 */

/**
 * The committed transition's endpoint identity (titles + tab-ness), latched
 * atomically at every settle arming. Defined here (not in Header.svelte) so the
 * probe snapshot can type it and Header.svelte imports the one shared shape.
 */
export interface HeaderSettleTransition {
	outgoingTitle: string;
	incomingTitle: string;
	outgoingHasTabs: boolean;
	incomingHasTabs: boolean;
}

export interface HeaderStateSnapshot {
	t: number;
	path: string;
	morph: number;
	slideT: string;
	rootLayerStyle: string;
	layerDownStyle: string;
	settling: boolean;
	isSettleMode: boolean;
	settleProgress: number;
	settleAwaitTitle: boolean;
	lastGestureMorph: number;
	currentHasTabs: boolean;
	targetHasTabs: boolean;
	prevHasTabs: boolean;
	latchedSettle: HeaderSettleTransition | null;
	effectiveTabsOut: boolean;
	effectiveTabsIn: boolean;
	navInFlight: boolean;
	pendingNav: string | null;
	dragging: boolean;
	backMorph: number | null;
}

declare global {
	interface Window {
		__headerMorphProbe?: HeaderStateSnapshot[];
	}
}
