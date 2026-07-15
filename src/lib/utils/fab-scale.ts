/**
 * fab-scale - pure (runes-free) math for the mobile Floating Action Button's
 * route-transition scale and scroll-driven translateY. Pure so it is
 * unit-testable under `bun test` (no Svelte runes loader required).
 *
 * Two independent drivers compose as ONE `transform: scale(s) translateY(y)`:
 *
 *   - Route-transition driver: `s = fabScale(progress, fromHasFab,
 *     toHasFab)`. The FAB exits in the first half of the transition
 *     (0 -> 0.5) if the FROM route shows a FAB, and enters in the second
 *     half (0.5 -> 1) if the TO route shows a FAB. `progress` is the
 *     same signal that drives the page-track slide.
 *   - Scroll driver: `p = hideProgress(translateY, headerHeight)`,
 *     `y = p * (fabHeight + bottomClearance)`. Mirrors the Header's hide-on-scroll.
 *
 * Scale and translateY act on different matrix dimensions, so there is no
 * precedence rule and no contention (orthogonal composition).
 */

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
 * The FAB family a route belongs to. Read by `route-config.ts`'s
 * `isPipelineSwipeDisabledRoute` (`family === 'overlay'`); not consumed
 * by the FAB layer's scale computation (which uses the FROM/TO
 * `RouteData.fab` booleans + `fabScale`).
 */
export type FabFamily = 'list' | 'overlay' | 'compose';

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
