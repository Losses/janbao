/**
 * fab-scale - pure (runes-free) math for the mobile Floating Action Button's
 * route-transition scale and scroll-driven translateY. Pure so it is
 * unit-testable under `bun test` (no Svelte runes loader required).
 *
 * Two independent drivers compose as ONE `transform: scale(s) translateY(y)`:
 *
 *   - Route-transition driver: `s = computeFabScale(inputs)`, where `inputs`
 *     bundles the publication's `progress`, FROM/TO FAB presence, and the
 *     boundary / suppressed / enter-anchor / drag-anchor overrides the FAB
 *     layer applies on top of the natural `fabScale(progress, fromHasFab,
 *     toHasFab)` formula. The natural formula exits the FAB in the first
 *     half of the transition (0 -> 0.5) if FROM shows a FAB, and enters in
 *     the second half (0.5 -> 1) if TO shows a FAB. `progress` is the
 *     orchestrator's raw drag fraction (`publication.progress`); on a
 *     non-bidirectional host (every NavPipelineHost route: threads,
 *     compose, deep pages) the page-track threshold-absorbs this same
 *     drag (`trackProgress` absorbs the first 20% as a deadzone), so
 *     the FAB reacts from the first pixel while the track absorbs the
 *     deadzone (spec §5).
 *   - Scroll driver: `p = hideProgress(translateY, headerHeight)`,
 *     `y = p * (fabHeight + bottomClearance)`. Mirrors the Header's hide-on-scroll.
 *
 * Scale and translateY act on different matrix dimensions, so there is no
 * precedence rule and no contention (orthogonal composition).
 */

import type { DragFabAnchor, EnterFabAnchor } from '$lib/utils/header-probe';
import { BOUNDARY_RUBBER_BAND_FACTOR } from '$lib/utils/gesture-constants';

interface ClampRange {
	readonly min: number;
	readonly max: number;
}

const SCALE_RANGE: ClampRange = { min: 0, max: 1 };

function clamp(value: number, range: ClampRange): number {
	if (value < range.min) return range.min;
	if (value > range.max) return range.max;
	// Normalize -0 to 0 so callers comparing against literal 0 are not surprised
	// by `0 === -0` being true yet `Object.is(0, -0)` being false in some matchers.
	return value === 0 ? 0 : value;
}

/**
 * The single-progress FAB scale, gated on FROM / TO FAB presence. The FAB
 * exits in the first half of the transition if FROM has a FAB, and enters
 * in the second half if TO has a FAB. At rest (no transition in flight)
 * the caller passes `progress = 1` with `fromHasFab = toHasFab =
 * currentRouteHasFab` (or short-circuits to `currentRouteHasFab ? 1 : 0`).
 *
 *   - both have FAB:   progress < 0.5 ? 1 - progress*2 : (progress - 0.5)*2
 *                      (exit then enter; dips to 0 at the midpoint)
 *   - from only:       max(0, 1 - progress*2)
 *                      (exit first half, stay 0)
 *   - to only:         max(0, (progress - 0.5)*2)
 *                      (stay 0, enter second half)
 *   - neither:         0
 */
export function fabScale(progress: number, fromHasFab: boolean, toHasFab: boolean): number {
	if (fromHasFab && toHasFab) {
		return clamp(progress < 0.5 ? 1 - progress * 2 : (progress - 0.5) * 2, SCALE_RANGE);
	}
	if (fromHasFab) {
		return clamp(Math.max(0, 1 - progress * 2), SCALE_RANGE);
	}
	if (toHasFab) {
		return clamp(Math.max(0, (progress - 0.5) * 2), SCALE_RANGE);
	}
	return 0;
}

/**
 * Scroll-hide progress for the FAB's translateY. `translateY` is the shared
 * scroll-chrome value in `[-headerHeight, 0]` (0 = Header visible,
 * -headerHeight = Header fully hidden). Returns 0 at rest, 1 when the Header
 * is fully hidden. Reads the same store the Header does, so the FAB inherits
 * the Header's thresholds, hysteresis, hold/release, and frozen state.
 */
export function hideProgress(translateY: number, headerHeight: number): number {
	if (headerHeight <= 0) return 0;
	return clamp(-translateY / headerHeight, SCALE_RANGE);
}

/**
 * Vertical offset (px) applied to the FAB when scroll-hidden. Positive values
 * slide the FAB down off the viewport bottom. `p = 1` -> the full
 * (fabHeight + bottomClearance) slide past the bottom edge.
 */
export function translateYFromHideProgress(
	p: number,
	fabHeight: number,
	bottomClearance: number
): number {
	return clamp(p, SCALE_RANGE) * (fabHeight + bottomClearance);
}

/**
 * The full input set the FAB layer's scale derivation reads, mirrored by the
 * orchestrator's `#fabScaleAtSettleInstant` helper so the two sites cannot
 * drift. Both consumers build this same shape from their respective reactive
 * sources and pass it to `computeFabScale`; sharing the function makes the
 * anchor capture mirror the displayed FAB by construction (DV21 §5: every
 * visual is a pure function of the one published progress, continuous at
 * every gesture boundary).
 */
export interface FabScaleInputs {
	/** The publication's raw drag / settle progress in [0, 1]. */
	readonly progress: number;
	/** True when the FROM route's `RouteData.fab` is set. */
	readonly fromHasFab: boolean;
	/** True when the TO route's `RouteData.fab` is set. */
	readonly toHasFab: boolean;
	/** True when the publication's `fromPathname === toPathname` (a
	 *  boundary void-swipe; the FAB reacts proportionally to the
	 *  rubber-band instead of running the icon-handoff half-mapping). */
	readonly isBoundary: boolean;
	/** True when the publication's plan has `pageTrack.distance === 0`
	 *  AND the TO route's tag is 'tab' (within-tab pagination; the FAB
	 *  freezes at the FROM resting scale). */
	readonly isSuppressedTab: boolean;
	/** True while a settle ease owns the morph / FAB / title crossfade. */
	readonly settleActive: boolean;
	/** The settle rAF's eased 0..1 timeline fraction (read by the enter
	 *  branch to lerp between `enterAnchor.start` and `enterAnchor.dest`). */
	readonly settleMorphFraction: number;
	/** The FAB lerp anchor during a settle (R8-A F4 + R10-A F1 + R12-B F1).
	 *  null outside a settle that owns the FAB; the FAB lerps between the
	 *  anchor's `start` and `dest` while
	 *  `settleActive && enterAnchor !== null`. */
	readonly enterAnchor: EnterFabAnchor | null;
	/** The settle-to-drag takeover anchor (R8-A F3). null when no settle
	 *  was in flight at `#beginGesture`; the FAB shifts the natural
	 *  `fabScale(progress, ...)` curve so it passes through
	 *  `(anchor.raw, anchor.scale)` while set. */
	readonly dragAnchor: DragFabAnchor | null;
}

/**
 * The single source of truth for the FAB's route-transition scale. Mirrors
 * the FAB layer's scale derivation branch-for-branch (R9-A F1):
 *
 *  1. Boundary void-swipe (`isBoundary`): react proportionally to the
 *     rubber-band instead of running the icon-handoff half-mapping (which
 *     dips to 0 at the midpoint, an over-reaction to a ~40% track
 *     displacement). When the route has no FAB the scale stays 0.
 *  2. Suppressed tab slide (`isSuppressedTab`): freeze the FAB at the FROM
 *     resting scale (within-tab pagination; both endpoints are tab routes,
 *     same panel, nothing else animates).
 *  3. Settle-owned FAB lerp (`settleActive && enterAnchor !== null`):
 *     lerp from the anchor's `start` to `dest` across `settleMorphFraction`.
 *     Five reach paths set the anchor (see `EnterFabAnchor`): the
 *     commit-to-enter handoff (`start` = prior commit's terminal scale,
 *     `dest` = destination's resting scale, R8-A F4); the discrete-nav
 *     interrupt of an in-flight settle (R10-A F1); the gesture-release
 *     settle (`start` = drag-terminal FAB value via
 *     `#fabScaleAtSettleInstant`, `dest` = destination's at-rest FAB
 *     presence on a commit, source's on a cancel, R12-B F1); the
 *     `onSvelteKitBeforeNavigate` discrete-nav arm at a tab-click /
 *     `goto` / popstate interrupt (`start` = captured in-flight FAB
 *     value, `dest` = destination's at-rest FAB presence, R12-B F1
 *     sibling); and the `notifyHeaderState` mid-settle absorb on a
 *     dynamic-title route (`start` = captured in-flight FAB value,
 *     `dest` = new endpoint's at-rest FAB presence, R12-B F1 sibling).
 *  4. Settle-to-drag takeover (`dragAnchor !== null`): shift the natural
 *     curve so it passes through the takeover visual. Constant in
 *     `progress`, so the formula stays a pure function of `progress`
 *     (DV21 §5). Clamped to [0, 1] for the cancel overshoot (R8-A F3).
 *  5. Default: the natural `fabScale(progress, fromHasFab, toHasFab)`
 *     formula (exit-then-enter icon handoff).
 *
 * Both the FAB layer and `#fabScaleAtSettleInstant` call this with the
 * current reactive state, so the anchor capture mirrors the displayed FAB
 * by construction (single source of truth). Pure (runes-free); unit-tested
 * under `bun test`.
 */
export function computeFabScale(inputs: FabScaleInputs): number {
	if (inputs.isBoundary) {
		return inputs.fromHasFab ? 1 - inputs.progress * BOUNDARY_RUBBER_BAND_FACTOR : 0;
	}
	if (inputs.isSuppressedTab) {
		return inputs.fromHasFab ? 1 : 0;
	}
	if (inputs.settleActive && inputs.enterAnchor !== null) {
		return (
			inputs.enterAnchor.start +
			(inputs.enterAnchor.dest - inputs.enterAnchor.start) * inputs.settleMorphFraction
		);
	}
	if (inputs.dragAnchor !== null) {
		const naturalAtProgress = fabScale(inputs.progress, inputs.fromHasFab, inputs.toHasFab);
		const naturalAtAnchor = fabScale(inputs.dragAnchor.raw, inputs.fromHasFab, inputs.toHasFab);
		return Math.max(0, Math.min(1, inputs.dragAnchor.scale + naturalAtProgress - naturalAtAnchor));
	}
	return fabScale(inputs.progress, inputs.fromHasFab, inputs.toHasFab);
}
