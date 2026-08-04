# RV21-C01 Audit 116 (R116)

**Date:** 2026-08-04. **Round:** R116. **Votes:** auditor A (pending),
auditor B BLOCK. **Counter after: 0/5.**

## Auditor B finding (CONFIRMED): 11th site in "gesture-terminal / drag's terminal" overclaim class

**F1** `Header.svelte:432` (DEV probe comment) -- said "the
gesture-terminal morph that drives the §5 continuity lives on the latched
record (`settleLatched.startMorph`)." `startMorph` is gesture-terminal
for only 2 of 6 arm paths. Fixed: "the morph value at the settle-arm
instant." B's sweep of 50+ "drag's terminal" hits + "gesture-terminal"
verified this as the only unfixed sibling. 11th and likely final site
in the class.

## Verify

`bun run check` 0/0; prettier + em-dash clean; grep confirms
"gesture-terminal" removed. Comment-only; runtime unchanged.

## Disposition

Counter after R116: 0/5. The 11th site in the "drag's terminal value /
gesture-terminal overclaim" class. With B's thorough sweep (50+ hits
verified, 1 defect found), this should be the final site in the class.
