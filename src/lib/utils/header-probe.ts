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
	 * `targetIsSearch` shape eases toward `atRestMorph(outgoingHasTabs)`
	 * (= 1 for a tab-root source): at landing `isSearch` flips to true
	 * and `iconProgress` / `rootLayerStyle` switch to the search-mode
	 * branch, but the pre-landing `morph` drives `rootLayerStyle`'s
	 * `translateY` until the flip, so easing toward 1 keeps the
	 * `translateY` at 0% across the settle and the landing's flip to
	 * `transform: none` is continuous (R8-A F1). For the no-anchor
	 * from-rest case `startMorph === destMorph`, so the lerp is a
	 * constant hold; for a re-grab whose `anchor.morph` differs, the
	 * ease bridges the gap.
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

/**
 * The FAB scale value the in-flight settle was rendering the instant a drag
 * took over (re-grab mid-commit, gesture-during-forward-enter), paired with
 * the publication's raw drag fraction at that instant. null when no settle
 * or transition was in flight at `#beginGesture` (drag from rest, or the
 * window where the macro has left `transitioning` while the settle rAF
 * is still ticking) or after the drag ends
 * (the next settle's arm / `#landAtRest` / `unmount` clears it). Read by the
 * FAB layer's scale derivation to shift the natural `fabScale(progress, ...)`
 * curve so it passes through the takeover visual (DV21 §5 "following-visual":
 * no jump at the settle-to-drag boundary). Mirrors `DragMorphAnchor` for the
 * FAB layer (the morph derivation consumes `DragMorphAnchor`, the FAB layer
 * consumes `DragFabAnchor`; both are captured at the same `#beginGesture
 * sites so the two visuals stay in lockstep).
 */
export interface DragFabAnchor {
	readonly scale: number;
	readonly raw: number;
}

/**
 * The search-axis position the in-flight settle was rendering the instant a
 * drag took over (re-grab mid-commit, gesture-during-forward-enter), paired
 * with the publication's raw drag fraction at that instant. null when no
 * settle or transition was in flight at `#beginGesture` (drag from rest, or
 * the window where the macro has left `transitioning` while the settle rAF
 * is still ticking), or when the in-flight settle had no search anchor
 * (`#searchAnchor === null`), or after the drag ends (the next settle's
 * arm / `#landAtRest` / `unmount` clears it). Read by
 * the Header's `searchProgress` drag-anchor branch to shift the natural
 * `isSearch ? 1 - trackMorph : targetIsSearch ? trackMorph : 0` curve so it
 * passes through the takeover visual (DV21 §5 "following-visual": no jump at
 * the settle-to-drag boundary). Mirrors `DragMorphAnchor` / `DragFabAnchor`
 * for the search axis (the morph derivation consumes `DragMorphAnchor`, the
 * FAB layer consumes `DragFabAnchor`, the Header search-track derivation
 * consumes `DragSearchAnchor`; all three are captured at the same
 * `#beginGesture` sites so the three visuals stay in lockstep). Captured only
 * when a search settle is in flight at `#beginGesture`
 * (`settleActive && #searchAnchor !== null && publication.inFlight`): a
 * re-grab taking over a
 * search-retreat or search-enter settle would otherwise snap the header
 * search track ~238px (R26-A defect) because the post-cancel
 * `#searchAnchor` clear hands the search axis to the natural `bm`-driven
 * formula whose value at the takeover disagrees with the held settle lerp.
 */
export interface DragSearchAnchor {
	readonly search: number;
	readonly raw: number;
}

/**
 * The FAB lerp anchor the FAB layer's `computeFabScale` branch 3 interpolates
 * from `start` to `dest` across `settleMorphFraction` during a settle. Five
 * reach paths set this anchor, each capturing `start` as the FAB value the
 * visual was rendering the instant before the settle took over:
 *   - `playEnterAnimation` at a forward-enter: `start` is the prior commit's
 *     terminal FAB scale (stashed because the publication's `progress` resets
 *     1 -> 0 between the commit and the enter); `dest` is the host route's
 *     FAB presence (R8-A F4).
 *   - `#accelerateInFlight` at a discrete-nav interrupt of an in-flight settle:
 *     `start` is captured via `#fabScaleAtSettleInstant` before the arm
 *     clears the anchor; `dest` carries over the prior anchor's `dest`
 *     (R10-A F1).
 *   - `#armSettleEaseFromGesture` at a gesture release: `start` is captured
 *     via `#fabScaleAtSettleInstant` before the arm clears the drag anchor;
 *     `dest` is the destination's (commit) or source's (cancel) at-rest FAB
 *     presence (R12-B F1). The captured value equals the displayed FAB at
 *     the release raw. The re-seed keeps the FAB continuous across the
 *     settle where the natural formula would differ from the captured
 *     value, and smooths over the natural handoff dip for both-have-FAB
 *     releases that cross the icon-handoff midpoint (commits at raw < 0.5,
 *     cancels at raw > 0.5); otherwise a no-op.
 *   - The `onSvelteKitBeforeNavigate` discrete-nav arm at a tab-click /
 *     `goto` / popstate interrupt of an in-flight drag or settle: `start`
 *     is captured via `#fabScaleAtSettleInstant` before the arm clears the
 *     anchors; `dest` is the destination's at-rest FAB presence (the arm
 *     always targets `settleTargetProgress = 1`, R12-B F1 sibling).
 *   - The `notifyHeaderState` mid-settle absorb when a dynamic-title route
 *     resolves a new title mid-enter: `start` is captured via
 *     `#fabScaleAtSettleInstant` before the arm clears `#enterFabAnchor`;
 *     `dest` is the new endpoint's at-rest FAB presence selected by
 *     `settleTargetProgress` (commit -> incoming, cancel -> outgoing,
 *     R12-B F1 sibling).
 *
 * The FAB layer reads the anchor via `orchestrator.enterFabAnchor` and
 * `computeFabScale` lerps between `start` and `dest` while
 * `settleActive && enterAnchor !== null`. Cleared at the next settle arm
 * (canonical single-site reset inside `#armSettleEase`), `#landAtRest`,
 * and `unmount`.
 */
export interface EnterFabAnchor {
	readonly start: number;
	readonly dest: number;
}

/**
 * The search-axis lerp anchor the Header's `searchProgress` derivation
 * interpolates from `start` to `dest` across `settleMorphFraction` during a
 * settle. Mirrors `EnterFabAnchor` for the search axis (the morph axis uses
 * `HeaderSettleTransition.startMorph` / `destMorph`; the FAB axis uses
 * `EnterFabAnchor`; the search axis uses `SearchAnchor`).
 *
 * Four reach paths set this anchor, each capturing `start` as the search-axis
 * position the Header was rendering the instant before the settle took over:
 *   - `playEnterAnimation` at a forward-swipe-to-`/search` commit-to-enter
 *     handoff: `start` is the prior commit's terminal searchProgress (= 1;
 *     the drag slid the search panel fully in via `searchProgress = bm` and
 *     the commit slide ended at `bm = 1`); `dest = 1` (hold) so the panel
 *     stays slid in across the enter settle and the enter slide's natural
 *     `searchProgress = 1 - trackMorph = bm` curve (which would re-animate
 *     the panel out then in as `bm` resets 1 -> 0 then runs 0 -> 1) is
 *     suppressed. At settle end the natural formula reads `bm = 1` again,
 *     continuous with the hold. Without the anchor the panel snaps fully
 *     out at the boundary then slides back in (~393px snap, R23-B F2).
 *   - The `onSvelteKitBeforeNavigate` discrete-nav arm at a non-search
 *     `goto` / tab-click / popstate interrupt of a forward-swipe-to-
 *     `/search`: `start` is captured via `#searchProgressAtSettleInstant`
 *     before the publication reset (the drag's live `bm`, e.g. 0.30);
 *     `dest = 0` (the non-search discrete-nav dest's at-rest searchProgress)
 *     so the search panel smoothly retreats during the discrete-nav settle.
 *     Without the anchor the panel snaps to 0 at the boundary
 *     (~118px snap at raw=0.30, R23-B F1).
 *   - `#accelerateInFlight` at a discrete-nav interrupt of an in-flight
 *     enter settle on `/search` (R24-A, R10-A F1 sibling): `start` is the
 *     search-axis position captured via `#searchProgressAtSettleInstant`
 *     before the accelerate's `#armSettleEase` clears the anchor;
 *     `dest` carries over the prior anchor's `dest` (the accelerate
 *     preserves endpoints, so the destination's at-rest searchProgress is
 *     unchanged). For the audit's flagship shape (a forward-swipe-to-
 *     `/search` commit-to-enter handoff interrupted by a discrete nav) the
 *     in-flight settle was seeded by `playEnterAnimation` with
 *     `start = dest = 1`; this re-seed carries the held-at-1 panel position
 *     across the accelerated re-arm. Without the re-seed the post-arm
 *     `#searchAnchor = null` would hand the search axis to the natural
 *     `searchProgress = bm` formula, whose `bm` value at the accelerate
 *     instant disagrees with the held-at-1 value the Header was rendering,
 *     snapping the panel partially out at the boundary (~304px snap on a
 *     393px viewport, R24-A).
 *   - The `notifyHeaderState` mid-settle absorb when a dynamic-title route
 *     resolves a new title mid-enter on a `/search` commit (R24-A, R12-B F1
 *     sibling): `start` is the search-axis position captured via
 *     `#searchProgressAtSettleInstant` before the re-arm's `#armSettleEase`
 *     clears the anchor; `dest` is the new endpoint's at-rest
 *     searchProgress (commit -> incoming route, cancel -> outgoing route).
 *     Carries the in-flight search-axis position across the re-arm so the
 *     Header's settle-anchor branch continues from the panel position it
 *     was rendering. Skipped when no search anchor was in flight at the
 *     capture (`prevSearchAnchor === null`) or when the helper returned
 *     null (no transition in flight).
 *
 * The Header reads the anchor via `orchestrator.searchAnchor` and the
 * `searchProgress` derivation lerps between `start` and `dest` while
 * `settleActive && searchAnchor !== null`. Cleared at the next settle arm
 * (canonical single-site reset inside `#armSettleEase`), `#landAtRest`,
 * and `unmount`.
 */
export interface SearchAnchor {
	readonly start: number;
	readonly dest: number;
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
