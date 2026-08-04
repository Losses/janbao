# RV21-C01 Audit 115 (R115)

**Date:** 2026-08-04. **Round:** R115. **Votes:** auditor A BLOCK, auditor
B (pending). **Counter after: 0/5.**

## Auditor A finding (CONFIRMED): 5th missed sibling from R100-A "drag-anchor" sweep

**F1** `orchestrator:1342-1344` (`#atRestMorph` docstring closing
parenthetical) -- said "a preceding drag hands its terminal morph to the
settle via the drag-anchor capture, not via this helper." Wrong for
from-rest drags: `#dragMorphAnchor` is null end-to-end; the terminal morph
is computed via the natural formula in `#dragMorphAtAnchorOrRaw` (not via
the drag-anchor). For from-rest `dragMorphWasStatic` shapes, the terminal
IS via `#atRestMorph` itself, contradicting "not via this helper." This
is the 5th site in the "drag's terminal value / drag-anchor overclaim"
class (R100-A fixed 3 sites; R114 fixed a 4th; this is the 5th). Fixed:
dropped the parenthetical entirely (the first clause "no live drag owns
the morph at these arm instants" is accurate and sufficient).

## Counter impact

R111 (1/5) + R112 (2/5) + R113 (3/5) were already wiped by R114. R115-A's
BLOCK keeps the counter at 0/5.

## Verify

`bun run check` 0/0; prettier + em-dash clean; grep confirms
"drag-anchor capture" removed. Comment-only; runtime unchanged.

## Disposition

Counter after R115: 0/5. The 5th and (likely) final missed sibling from
the R100-A "drag's terminal value / drag-anchor" sweep. With all 5 sites
now fixed, this class should be fully exhausted.
