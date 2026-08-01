# RV21-C01 Audit 71 (R71)

**Date:** 2026-07-31. **Round:** R71. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A findings (CONFIRMED): R70 replace_all mistake + missed sibling

**F1:** `orchestrator:941` (dragMorphAnchor getter) -- R70's replace_all
added "or transition" wrongly (morph capture guard has NO
`publication.inFlight` check). Reverted to "no settle was in flight".

**F2:** `orchestrator:738` (`#dragFabAnchor` field) -- R70's replace_all
missed this site (FAB capture guard HAS `publication.inFlight`). Added
"or transition" qualifier.

## Auditor B finding 3 (CONFIRMED): fab-scale.ts:133

`src/lib/utils/fab-scale.ts:133` (FabScaleInputs.dragAnchor field) -- "null
when no settle was in flight" -- same DragFabAnchor null condition. Added
"or transition" qualifier. R70's grep didn't reach fab-scale.ts.

## Verify

`bun run check` 0/0; prettier + em-dash clean. Comment-only; runtime
unchanged.

## Disposition

Counter after R71: 0/5.
