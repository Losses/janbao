# RV21-C01 Audit 79 (R79)

**Date:** 2026-08-01. **Round:** R79. **Votes:** auditor A PASS, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor B finding (CONFIRMED): Bug 3 docstring `destMorph` for the `targetIsSearch` case

**F1:** `e2e/reproduce-dv20-search-swipe.spec.ts:76` (Bug 3 docstring,
`targetIsSearch` forward-swipe-to-`/search`) said the settle interpolates
"toward the destination's at-rest morph". For this shape the code holds
`destMorph` at the SOURCE's at-rest morph: `#armSettleEaseFromGesture`
(`orchestrator:3500-3504`)
`destMorph = isDeepToDeep ? 0 : targetIsSearch ? atRestMorph(outgoingHasTabs) : ...`
-- for a tab-root source `destMorph = atRestMorph(true) = 1`, while the
`/search` destination's at-rest morph is 0. So the settle is a constant
hold at 1 (start = dest = source's at-rest); the search-mode flip is a
landing event, not a settle interpolation toward 0. The in-source comment
(`orchestrator:3490-3499`) documents exactly this. Rewrote the docstring to
"eases toward the SOURCE's at-rest morph (`destMorph = atRestMorph(outgoing)`,
matching `startMorph` for a from-rest tab-root source so the morph holds
constant and the search-mode flip is carried by the landing), never toward
the destination's at-rest morph".

## Auditor A: PASS

Auditor A PASSed with exhaustive sampling (full orchestrator, consumers,
utils, ~33 e2e spec docstrings, §5 sweep, comment-freshness sweep). Did not
flag the Bug 3 `destMorph` site; B's sampling reached the `targetIsSearch`
destMorph computation. The value of two independent auditors with different
sampling paths.

## Orchestrator verification

Independently verified B-F1 before fixing. Confirmed the code
(`orchestrator:3500-3504`: `targetIsSearch ? atRestMorph(outgoingHasTabs)`)
and the in-source comment (`:3490-3499`: "SOURCE's at-rest morph ... holds
at 1 across the settle ... landing's flip ... is a no-op"). Sibling sweep
for "destination's at-rest" across e2e: four sites -- the defect plus
`messages-back-swipe:1503` (centerTab -> tab-root, non-targetIsSearch,
destMorph IS destination's at-rest), `:1738` (arm-fire condition,
non-targetIsSearch), `:2840` (FAB axis, dest IS destination's at-rest FAB).
All three legitimate; only the `targetIsSearch` morph site is the defect.
No missed siblings.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
Comment-only (e2e spec docstring); runtime unchanged.

## Disposition

Counter after R79: 0/5 (auditor B's BLOCK resets; auditor A's PASS does not
count when the other auditor BLOCKs). The e2e spec docstring surface
established in R78 continues to yield one defect per round.
