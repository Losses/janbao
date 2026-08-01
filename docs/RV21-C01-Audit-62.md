# RV21-C01 Audit 62 (R62)

**Date:** 2026-07-31. **Round:** R62. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): orchestrator:4079 "asymmetric FAB shapes"

`orchestrator:4079` said "would snap ... for asymmetric FAB shapes" --
both-have-FAB enter settle re-arms also snap (A verified numerically:
both-have-FAB enter at p=0.5 -> snap=1.0). Rewrote to universal
"wherever they diverge".

## Auditor B finding (CONFIRMED): fab-release-snap field attribution

`e2e/fab-release-snap.spec.ts:8` said "the live `pager.fractionalIndex`
drives it" and `:205` "stops the drag at fractionalIndex 0.305" -- the
FAB scale is driven by `publication.progress`, not `pager.fractionalIndex`
(which is the pill-highlight position). Fixed both to
`publication.progress`.

## Verify

`bun run check` 0/0; prettier + em-dash clean. Comment-only; runtime
unchanged.

## Disposition

Counter after R62: 0/5.
