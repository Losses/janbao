# RV21-C01 Audit 66 (R66)

**Date:** 2026-07-31. **Round:** R66. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): 2 SEARCH re-seed skip mis-described

`orchestrator:4094` and `header-probe.ts:223` said "Skipped when
`#searchAnchor` was null (no transition in flight)" -- but the SEARCH
re-seed guard is a conjunction (`prevSearchAnchor !== null &&
capturedSearchProgress !== null`) with two independent skip conditions:
(1) `prevSearchAnchor === null` (non-search settle, can have
`inFlight===true`); (2) `capturedSearchProgress === null` (helper
short-circuits, can have `searchAnchor !== null`). Rewrote both to name
both conditions (matching the accurate inline at `orchestrator:4129-4140`).

## Auditor B finding (CONFIRMED): sampleFrame branch-3 overclaim

`nav-executor-logic.ts:405` said the clamp makes "the FAB (branch 5...;
branch 3...) ease smoothly" -- the clamp bounds `publication.progress`
only; branch 3 reads the unclamped `settleMorphFraction`. Rewrote to
"the branch-5 FAB (...; branch 3 reads the unclamped `settleMorphFraction`
and is not bounded by this cap)".

## Verify

`bun run check` 0/0; prettier + em-dash clean. Comment-only; runtime
unchanged.

## Disposition

Counter after R66: 0/5.
