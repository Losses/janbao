# RV21-C01 Audit 58 (R58)

**Date:** 2026-07-31. **Round:** R58. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): search-axis formula universalized

`orchestrator:3262-3267` said "searchProgress = trackMorph = bm" and
"the drag's terminal `bm` agrees with the post-settle at-rest
searchProgress" universally. This only holds for the ENTER shape
(targetIsSearch, searchProgress = trackMorph = bm, at-rest = 1). For the
EXIT shape (isSearch, searchProgress = 1 - trackMorph, at-rest = 0) the
formula is 1 - bm. Rewrote to qualify ENTER (`trackMorph`) vs EXIT
(`1 - trackMorph`) + generic "gesture-branch value equals at-rest".

## Auditor B finding (CONFIRMED): captured value binary classification

`orchestrator:799-801` said "branch 5 natural for a from-rest release,
branch 4 dragAnchor-shifted for a re-grab" -- a binary partition that
omits boundary (branch 1) and suppressed (branch 2) from-rest releases.
A boundary void-swipe captures branch 1's `1 - progress * 0.4` value,
not branch 5 natural. Rewrote to "the same `computeFabScale` value the
FAB layer was rendering, whatever branch won" (universal, matching the
`orchestrator:3500` pattern).

## Verify

`bun run check` 0/0; prettier + em-dash clean. Comment-only; runtime
unchanged.

## Disposition

Counter after R58: 0/5.
