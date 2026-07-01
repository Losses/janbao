/**
 * DEV-ONLY Header morph-state probe sink.
 *
 * Header.svelte pushes a per-flush snapshot of its tab-morph state machine
 * (morph / slideT / settling / navInFlight / ...) to window.__headerLog on every
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

export interface HeaderStateSnapshot {
	t: number;
	path: string;
	morph: number;
	slideT: string;
	rootLayerStyle: string;
	settling: boolean;
	settleProgress: number;
	settleAwaitTitle: boolean;
	lastGestureMorph: number;
	currentHasTabs: boolean;
	targetHasTabs: boolean;
	prevHasTabs: boolean;
	navInFlight: boolean;
	pendingNav: string | null;
	dragging: boolean;
	backMorph: number | null;
}

declare global {
	interface Window {
		__headerLog?: HeaderStateSnapshot[];
	}
}
