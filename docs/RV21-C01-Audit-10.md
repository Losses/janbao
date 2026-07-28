# RV21-C01 Audit 10 (R10)

**Date:** 2026-07-28. **Round:** R10. **Counter after:** 0/5 (auditor A BLOCK;
auditor B PASS - the first PASS vote in the cycle). **Gate:** green (230/0).

## R10-A F1 (§5): FAB scale snaps at the accelerate-in-flight boundary

`#accelerateInFlight` (discrete nav interrupting an in-flight enter settle)
calls `#armSettleEase` which clears `#enterFabAnchor`. The morph and title
tiers are correctly captured (`startMorph = #morphAtSettleInstant`,
`startProgress = settleProgress`) but the FAB has no equivalent: after the clear
the FAB scale derivation falls to the natural `fabScale(progress, ...)`, which
disagrees with the held enter-anchor value at the accelerate instant. Probe-
verified 5/5: FAB snap 0.44-0.58 on `/messages/inbox -> /search` forward-swipe
interrupted mid-enter by a `goto`.

**Fix:** capture the FAB's in-flight value via `#fabScaleAtSettleInstant()` in
`#accelerateInFlight` and re-seed `#enterFabAnchor = { start: capturedValue,
dest: prevDest }` after the `#armSettleEase` clear (mirror the morph/title
pattern). Rewrite the stale L2794-2799 comment. Add a preventive no-snap guard.

## R10-B: PASS (no defect)

Auditor B exhaustively verified: the shared `computeFabScale` matches the FAB
layer; title-span continuity at re-grab/release; `#settleEasedFraction`; the
resolver dispatch; SearchScopePager lazy-mount; deferrals; tooling; e2e
helpers; comment accuracy. No defect. The first PASS vote in the cycle.

## Leftover probe specs

Both auditors flagged `e2e/probe-*.spec.ts` (temporary debug files from R8 that
were not deleted before commit). Deleted this round.
