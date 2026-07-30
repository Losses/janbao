# RV21-C01 Audit 26 (R26)

**Date:** 2026-07-29. **Round:** R26. **Counter after:** 0/5 (auditor A BLOCK;
auditor B BLOCK).

## R26-A (§5): search axis missing drag-owned anchor (parity gap)

The morph axis has `#dragMorphAnchor` (R8-A F1+F2, captured at #beginGesture
for re-grab takeover). The FAB axis has `#dragFabAnchor` (R8-A F3). The search
axis has `#searchAnchor` (settle-owned, R23-B/R24-A, four reach paths) but NO
drag-owned counterpart. A re-grab that takes over an in-flight search-retreat
settle loses the in-flight value and snaps (~96-143px, probe-verified 3/3).

**Fix:** add `#dragSearchAnchor` (mirrors `#dragFabAnchor`), captured at
`#beginGesture` when a search settle is in flight. The Header's `searchProgress`
derivation gains a drag-anchor branch that holds the in-flight value at the
takeover and decays it toward the gesture/at-rest value as `bm` advances.

## R26-B F1 (comment): computeFabScale docstring overclaims "unit-tested"

The docstring says "Pure (runes-free); unit-tested under `bun test`" but the
function has ZERO unit tests (only `fabScale`/`hideProgress`/
`translateYFromHideProgress` are tested). Fix: change to "exercised by the
R8-R14 e2e continuity guards" (accurate).

## R26-B F2 (comment): my R25 edit fabricated "R24-A F1+F2"

R24-A was NOT F-numbered (it was one finding covering two sub-sites). My R25
edit added "(R23-B F1+F2, R24-A F1+F2)" to the Header comment, fabricating the
F-numbering and under-describing the R24-A reach paths in the body. Fix: change
to "R23-B + R24-A" and expand the body to describe all four reach paths.

## Counter after R26: 0/5.
