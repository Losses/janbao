# RV21-C01 Audit 117 (R117)

**Date:** 2026-08-04. **Round:** R117. **Votes:** auditor A BLOCK, auditor
B PASS. **Counter after: 0/5.**

## Auditor A finding (CONFIRMED): 3 helper docstring titles -- sites 12-14 in "drag's terminal morph" class

**F1** `orchestrator:3586` (`#dragMorphAtSettleTakeover` title) -- "The
drag's terminal morph at the moment a settle takes over" -- wrong for
from-rest (returns atRestMorph(outgoing), no drag). Fixed: "The morph
value at the settle-arm instant."

**F2** `orchestrator:3650` (`#dragMorphAtAnchorOrRaw` title) -- "The
drag's terminal morph at release" -- wrong for discrete-nav interrupt (not
release) and from-rest (no drag). Fixed: "The morph value at the
settle-arm instant."

**F3** `orchestrator:3657` (`#dragMorphAtAnchorOrRaw` body) -- "equals
the drag's terminal morph" -- wrong for from-rest. Fixed: "equals the
morph value this helper computed."

A's sweep of 26+ hits verified these 3 as the only unfixed siblings. The
prior sweeps covered fields, publications, probe, arm-block comments, and
the Header probe -- but missed the helper docstring titles. With these 14
sites fixed, the class should be fully exhausted.

## Auditor B: PASS

Exhaustive sampling, zero concerns. Verified R115-R116 fixes accurate.
Full "drag's terminal value" sweep (50+ hits classified, no defect).

## Verify

`bun run check` 0/0; prettier + em-dash clean; grep confirms "The drag's
terminal morph" removed from helper titles. Comment-only; runtime unchanged.

## Disposition

Counter after R117: 0/5. 14 sites in the "drag's terminal value /
gesture-terminal overclaim" class. R117-A's thorough sweep (26+ hits
classified) suggests these are the final helper-title sites.
