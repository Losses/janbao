# RV21-C01 Audit 40 (R40)

**Date:** 2026-07-30. **Round:** R40. **Votes:** auditor A BLOCK, auditor
B BLOCK (different findings). **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): FAB cadence at L2230

`e2e/messages-back-swipe.spec.ts:2230` "regular per-rAF cadence ...
~0.05 scale". R38 fixed the px/deg components of this same comment but
missed the FAB component. The formalized AFTER (journal L3443) is
`fabJumps.max = 0.12`, and the FAB formula's derivative ±2 at a progress
delta of ~0.06 gives 0.12. Fixed `~0.05 scale` -> `~0.12 scale`.

## Auditor B finding (CONFIRMED): offline guard regression-example misattribution

`e2e/offline-back-swipe.spec.ts:30-35` claimed dropping the
`!isCenterTabRoute` qualifier snaps `/offline` -> `/`. Verified against
the code: for `/offline` -> `/` `isCenterTabRoute=false, isTabToTab=true`,
so `dragMorphWasStatic = targetIsSearch || (isTabToTab && !isCenterTabRoute)`
is `true` both with and without the qualifier, and `backMorph` is null
for this shape so the drag is genuinely static. Dropping the qualifier
actually snaps the centerTab shape (`/messages/<id>` -> `/messages/inbox`,
live `backMorph`), which the R1 test guards. Reworded the example to
attribute the snap to the centerTab shape and state the offline guard
asserts the non-centerTab `/offline` -> `/` shape stays continuous.

## Verify

`bun run check` 0/0; `bun run lint` exit 0; prettier + em-dash clean on
both edited files. Comment-only; runtime unchanged.

## Disposition

Counter after R40: 0/5.
