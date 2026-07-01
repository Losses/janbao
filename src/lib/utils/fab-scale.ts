/**
 * fab-scale - pure (runes-free) math for the mobile Floating Action Button's
 * route-transition scale and scroll-driven translateY. Pure so it is
 * unit-testable under `bun test` (no Svelte runes loader required).
 *
 * Two independent drivers compose as ONE `transform: scale(s) translateY(y)`:
 *
 *   - Route-transition driver: `s = scaleFromFraction(foregroundFraction)`.
 *     foregroundFraction is the live gesture/page progress 0..1 (1 = the
 *     source list is fully foreground, 0 = fully covered). scale maps it 1:1
 *     over the full range so the FAB follows the finger across the whole drag.
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
 * foregroundFraction -> scale over the full [0,1] range. The FAB tracks the
 * live gesture position across the whole drag.
 */
export function scaleFromFraction(fraction: number): number {
	return clamp(fraction, SCALE_RANGE);
}

/**
 * Fraction of tab `tabIndex`'s surface covered by the pager at the sampled
 * fractional index. 1 when the tab is fully foreground, 0 when fully away,
 * linear in between. Used by the Family A (list) sampler path and the list
 * resting fraction.
 */
export function tabFraction(sampledFractionalIndex: number, tabIndex: number): number {
	return clamp(1 - Math.abs(sampledFractionalIndex - tabIndex), SCALE_RANGE);
}

/**
 * The FAB transition family a route belongs to. Mirrors the layer's FabConfig
 * `family` discriminant so pure helpers can branch on it without importing the
 * Svelte component.
 */
export type FabFamily = 'list' | 'overlay' | 'compose';

/**
 * Whether the family's FAB scale is driven by the per-frame track sampler.
 *
 * Only Family A (list / tab pager): the MobileTabPager `fractionalIndex` jumps
 * to its integer endpoint on release while the track keeps easing, so the
 * per-frame track read is the continuous signal across the snap. Family B
 * (overlay) reads the live `coverProgress` store signal directly (no sampler);
 * Family C (compose) eases its discrete swap via the atom CSS transition.
 */
export function familyNeedsSamplerDuringDrag(family: FabFamily): boolean {
	return family === 'list';
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
