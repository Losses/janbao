/**
 * DEV-ONLY Header morph-state probe sink.
 *
 * Header.svelte pushes a per-flush snapshot of its tab-morph state machine
 * (morph / settling / ...) to window.__headerMorphProbe on every
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
 *
 * `startMorph` / `destMorph` carry the morph values the settle interpolates
 * between, so the Header's morph derivation stays continuous across the
 * drag-to-settle handoff for every gesture shape (DV21 §5). The drag branch
 * publishes a gesture-feedback morph (e.g. `1 - bm` on a centerTab route, or
 * `1` on a `targetIsSearch` skip) whose terminal value at release can disagree
 * with both endpoints' at-rest morph values; without a captured startMorph the
 * settle branch collapses to a constant for shapes where
 * `outgoingHasTabs === incomingHasTabs` (e.g. centerTab to tab-root) and snaps
 * the icon plus layer translateY in one rAF frame at release.
 */
export interface HeaderSettleTransition {
	outgoingTitle: string;
	incomingTitle: string;
	outgoingHasTabs: boolean;
	incomingHasTabs: boolean;
	/**
	 * The morph value captured at settle-arm time. For a gesture-release
	 * settle this is the drag branch's terminal value (the live morph the
	 * Header was rendering the instant before the settle took over). For a
	 * non-gesture arm (a discrete nav, an enter, an idle title change) this
	 * is the source route's at-rest morph (`outgoingHasTabs ? 1 : 0`), so
	 * the morph holds at the source's tab-ness until the settle's first
	 * eased step.
	 */
	readonly startMorph: number;
	/**
	 * The morph value the settle ends at (the destination of the
	 * interpolation). For most shapes a commit (targetProgress = 1) ends
	 * at the incoming route's at-rest morph and a cancel
	 * (targetProgress = 0) ends at the outgoing route's at-rest morph
	 * (the gesture returns to rest on the source route). The
	 * `targetIsSearch` shape is the exception: at landing `isSearch`
	 * flips to true and `iconProgress` / `rootLayerStyle` switch to the
	 * search-mode branch, so animating toward the `/search` at-rest
	 * morph during the settle would rotate the icon to back-arrow then
	 * snap it back to hamburger at landing; for that shape
	 * `destMorph = startMorph` and the lerp is a constant hold.
	 */
	readonly destMorph: number;
}

/**
 * The morph value the in-flight settle was rendering the instant a drag took
 * over (re-grab mid-commit, gesture-during-forward-enter), paired with the
 * publication's raw drag fraction at that instant. null when no settle was in
 * flight at `#beginGesture` (drag from rest) or after the drag ends (the next
 * settle's arm / `#landAtRest` / `unmount` clears it). Read by the Header's
 * morph drag branch to shift the natural drag-morph curve so it passes through
 * the takeover visual (DV21 §5 "following-visual": a drag tracks from the
 * current visual, no jump). Symmetric to how the settle's `startMorph` captures
 * the drag's terminal value at release.
 */
export interface DragMorphAnchor {
	readonly morph: number;
	readonly raw: number;
}

export interface HeaderStateSnapshot {
	t: number;
	path: string;
	morph: number;
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
	dragging: boolean;
	backMorph: number | null;
}

declare global {
	interface Window {
		__headerMorphProbe?: HeaderStateSnapshot[];
	}
}
