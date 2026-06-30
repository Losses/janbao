/**
 * fab-scale - pure (runes-free) math for the mobile Floating Action Button's
 * route-transition scale and scroll-driven translateY. Pure so it is
 * unit-testable under `bun test` (no Svelte runes loader required).
 *
 * Two independent drivers compose as ONE `transform: scale(s) translateY(y)`:
 *
 *   - Route-transition driver: `s = scaleFromFraction(foregroundFraction)`.
 *     Disappear in the first 50% of foregroundFraction (1 -> 0), appear in the
 *     last 50% (0 -> 1). Symmetric across drag and snap.
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
 * foregroundFraction -> scale. Symmetric half/half: disappear over the first
 * 50% (f in [0, 0.5] -> 0), appear over the last 50% (f in [0.5, 1] -> 0..1).
 */
export function scaleFromFraction(fraction: number): number {
	return clamp(2 * fraction - 1, SCALE_RANGE);
}

/**
 * Fraction of tab `tabIndex`'s surface covered by the pager at the sampled
 * fractional index. 1 when the tab is fully foreground, 0 when fully away,
 * linear in between. The list-page foregroundFraction on a tab route.
 */
export function tabFraction(sampledFractionalIndex: number, tabIndex: number): number {
	return clamp(1 - Math.abs(sampledFractionalIndex - tabIndex), SCALE_RANGE);
}

/**
 * Map a horizontal track translate (m41, px) to a 0..1 progress across one
 * panel width. `m41 = 0` (no offset) -> 0; `m41 = -trackWidth` (one full panel
 * slide leftward) -> 1. threadCoverProgress on a GesturePageLayout route.
 */
export function pxToFraction(m41: number, trackWidth: number): number {
	if (trackWidth <= 0) return 0;
	return clamp(-m41 / trackWidth, SCALE_RANGE);
}

/**
 * Family B: the source list's foreground fraction during a thread/conversation
 * enter or exit. threadCoverProgress is the sampled GesturePageLayout track
 * position (0 = list preview visible, 1 = thread fully covers). The list is
 * fully foreground at threadCoverProgress 0 (forward enter start, back-swipe
 * end) and fully covered at threadCoverProgress 1 (thread at rest). The track
 * always renders two panels (left preview + center thread) for these routes,
 * so pxToFraction reaches 1 at rest regardless of the route's centerTab.
 */
export function listForegroundFromThreadCover(threadCoverProgress: number): number {
	return clamp(1 - threadCoverProgress, SCALE_RANGE);
}

/**
 * The FAB transition family a route belongs to. Mirrors the layer's FabConfig
 * `family` discriminant so pure helpers can branch on it without importing the
 * Svelte component.
 */
export type FabFamily = 'list' | 'overlay' | 'compose';

/**
 * Whether the family's FAB scale must be driven by the per-frame sampler WHILE
 * a drag is in progress (rather than by the live `pager.fractionalIndex`).
 *
 * Family A (list routes): false. The tab pager publishes a continuous
 * `fractionalIndex` during the drag, so the layer reads it directly.
 *
 * Family B (overlay routes): true. A thread/conversation route's
 * GesturePageLayout publishes `fractionalIndex = centerTab` for the whole
 * back-swipe drag (the route has no `rightTab`, so the `rightTab !== undefined`
 * pill-interpolation branch is skipped and `progressVal = centerTab`). The
 * live value would pin the scale at its resting endpoint; the sampler must
 * read the actual GPL track `m41` each frame to follow the finger 0 -> 1
 * (back-swipe, second-half appear) and 1 -> 0 (forward-enter, first-half
 * disappear).
 *
 * Family C (compose routes): false (no sibling track exists; the atom's CSS
 * transition eases the discrete swap).
 */
export function familyNeedsSamplerDuringDrag(family: FabFamily): boolean {
	return family === 'overlay';
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
