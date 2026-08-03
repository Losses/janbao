# RV21-C01 Audit 106 (R106)

**Date:** 2026-08-03. **Round:** R106. **Votes:** auditor A BLOCK, auditor
B PASS. **Counter after: 0/5.**

## Auditor A finding (CONFIRMED): SearchScopePager LoAF bar comment points to wrong file

**F1** `SearchScopePager.svelte:101` -- the comment said "the LoAF bar
in `e2e/reproduce-dv20-search-swipe.spec.ts` 'Bug 4' fails at 4x CPU."
Wrong: the LoAF budget was moved to `scripts/measure-search-jank.ts`
per the Fix D resolution; the e2e spec only checks cadence. The
spec's own comments (lines 185-189, 265-271) confirm this. Fixed:
"the LoAF bar in `scripts/measure-search-jank.ts` enforces a 150ms
worst-frame budget at 4x CPU in the production build."

**Counter impact:** R104 (1/5) + R105 (2/5) wiped by this BLOCK.
Counter resets to 0/5.

## Auditor B: PASS

Exhaustive sampling (full orchestrator + Header + header-probe + FAB +
state machine + resolvers + SearchScopePager + scroll-chrome). Every
count cross-checked (5/5/6/6/2), every §5 boundary, every R82-R103 fix
verified. Zero concerns.

## Orchestrator verification

A: confirmed the e2e spec's Bug 4 only checks cadence (`Math.max(hdrRange,
deepRange) > 10`), not LoAF; the budget lives in `scripts/measure-search-
jank.ts:27` (`JANK_BUDGET_MS = 150`). The spec's own comments at lines
185-189 and 265-271 explicitly attribute the budget to the script. `bun
run check` 0/0; prettier + em-dash clean.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R106: 0/5. A pre-existing comment inaccuracy (missed by
R104/R105's sweeps that focused on the morph block + searchProgress)
reset the convergence climb. The fix is applied; R107 starts a new climb.
