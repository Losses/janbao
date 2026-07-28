# RV21-C01 Audit 12 (R12)

**Date:** 2026-07-28. **Round:** R12. **Counter after:** 0/5 (auditor A BLOCK;
auditor B BLOCK). **Gate at audit time:** `bun run check` 0/0; `bun run lint`
exit 0; `bunx tsc -p scripts/tsconfig.json` exit 0; `bun test src/lib` 552/0.

## R12-B F1 (§5, primary): FAB scale snaps at the release/drag-to-settle handoff

The morph tier is continuous at the release handoff (R1's
`#dragMorphAtSettleTakeover` captures the drag's terminal morph value as the
settle's `startMorph`). The FAB tier has NO equivalent: `#armSettleEaseFromGesture`
clears `#dragFabAnchor` at the arm, and during the settle the FAB layer reads the
natural `fabScale(progress, ...)` formula (branch 5), which disagrees with the
drag's terminal FAB value for asymmetric shapes (from-only-FAB, to-only-FAB,
boundary, suppressed, enterAnchor). Probe-verified on `/bookmarks` -> `/messages/inbox`
back-swipe re-grab+cancel: FAB snap 0.796 at the release boundary (t=769ms).

**Fix (mirror the morph tier):** `#armSettleEaseFromGesture` must capture the
FAB's terminal value via `#fabScaleAtSettleInstant()` and the FAB layer's scale
derivation must lerp from that captured value to the destination's at-rest FAB
scale across `settleMorphFraction` during the settle (the SAME pattern the morph
uses: `startMorph` -> `destMorph` across the eased fraction). This requires a
settle-FAB-lerp mechanism (a `settleFabStart` + `settleFabDest` or reusing the
existing enterFabAnchor for the release-settle case too). The key: the FAB's
settle start = the drag's terminal FAB value (captured at release), so the
release handoff is continuous.

Add a preventive no-snap guard sampling `fabScale` across a back-swipe release
on an asymmetric-FAB shape (e.g. `/bookmarks` -> `/messages/inbox`).

## R12-A F1 (comment, fixed): offline-back-swipe.spec.ts:17 grammatical break

The R11 word-swap ("ANY host" -> "non-centerTab host types") accidentally dropped
the closing `` `#republishToPager`), ``. **Fixed this round** (restored the
parenthetical + function reference).

## Counter after R12: 0/5.
