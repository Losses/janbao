/**
 * search-underline - the stretchy underline geometry for SearchTabBar, extracted
 * as a pure function so the math is unit-testable (it cannot be tested while
 * inlined as a `$derived.by` inside the component).
 *
 * Given the pager's `fractionalIndex` (active cell + fractional drag, 0..N-1),
 * the drag direction, and the cell count, returns the underline `{left, width}`
 * as percentages of the strip. The edge toward the drag direction (leading)
 * races to the target while the trailing edge lags behind it (by `lag`), so the
 * underline stretches past one cell then settles back - never contracting below
 * one cell. Equal-width cells keep the math closed-form (no measurement).
 */
export interface UnderlineStyle {
	left: number;
	width: number;
}

export const SEARCH_UNDERLINE_LAG = 0.5;

function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v));
}

export function searchUnderline(
	fractionalIndex: number,
	dragging: boolean,
	dragDir: number,
	cellCount: number,
	lag: number = SEARCH_UNDERLINE_LAG
): UnderlineStyle {
	const cellPct = 100 / cellCount;
	const f = fractionalIndex;
	const resting = !dragging || dragDir === 0;
	if (resting) {
		const i = Math.round(f);
		return { left: clamp(i * cellPct, 0, 100 - cellPct), width: cellPct };
	}
	if (dragDir > 0) {
		const a = Math.floor(f);
		const tt = f - a;
		const g = Math.max(0, (tt - lag) / (1 - lag));
		const lo = a * cellPct + g * cellPct;
		const hi = (a + 1 + tt) * cellPct;
		return { left: clamp(lo, 0, 100 - cellPct), width: clamp(hi - lo, cellPct, 100) };
	}
	const a = Math.ceil(f);
	const tt = a - f;
	const g = Math.max(0, (tt - lag) / (1 - lag));
	const lo = (a - tt) * cellPct;
	const hi = (a + 1) * cellPct - g * cellPct;
	return { left: clamp(lo, 0, 100 - cellPct), width: clamp(hi - lo, cellPct, 100) };
}
