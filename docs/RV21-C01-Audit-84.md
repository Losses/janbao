# RV21-C01 Audit 84 (R84)

**Date:** 2026-08-02. **Round:** R84. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

Both findings were residuals in the orchestrator's OWN prior fixes
(R82-B-F1 and R82-F9 / R83) -- a rewrite-of-a-rewrite pattern. Both fixed
definitively this round.

## Auditor A finding (CONFIRMED): BurgerArrowIcon dropped the `isSearch` case

**F1:** `src/lib/components/atoms/BurgerArrowIcon.svelte:27-30` (the
R82-B-F1 rewrite) said "iconProgress is `1 - morph` outside a scrub". The
actual derivation (Header.svelte:321) is
`return isSearch || (searchScrubbing && currentHasTabs) ? 0 : 1 - morph`.
At `/search` (`isSearch === true`) the docstring predicted
`1 - morph = 1 - 0 = 1` (a fully-rotated back-arrow); the code returns
`0` (a hamburger) -- wrong by 180deg. Rewrote to capture the full
fallback: "`tapMorph * scrubIconEndpoint` during a tap-scrub; otherwise
`isSearch || (searchScrubbing && currentHasTabs) ? 0 : 1 - morph` (0
freezes the hamburger on /search and holds it during a tab-root scrub;
`1 - morph` tracks the morph ...)".

## Auditor B finding (CONFIRMED): swipe-back-pill-flicker still conflated the publication record with the pager-store write

**F1:** `e2e/swipe-back-pill-flicker.spec.ts:15-18` (the R82-F9 / R83
rewrite) said "the orchestrator's publication (...) is written to the
pager store by `#republishToPager`". The parenthetical identifies the
`OrchestratorPublication` record (a `$derived` the FAB reads directly);
that record is NOT written to the pager store -- `#republishToPager`
writes selected derived FIELDS (`active` / `backMorph` / etc.). The
OrchestratorPublication interface's own docstring (`orchestrator:277-293`)
explicitly distinguishes the two ("The FAB layer reads this publication
directly; the orchestrator publishes the in-flight pager fields via
`#republishToPager`"). Rewrote to "the orchestrator publishes
continuously via `#republishToPager` ..., holding the destination tab's
`active: true` in the pager store" -- no record / field-write conflation.

## Orchestrator verification

Independently verified both before re-editing. A-F1: re-read the
`iconProgress` body (Header.svelte:317-321: the fallback IS
`isSearch || (searchScrubbing && currentHasTabs) ? 0 : 1 - morph`).
B-F1: re-read the OrchestratorPublication interface docstring
(`:277-293`: "the FAB layer reads this publication directly; the
orchestrator publishes the in-flight pager fields via `#republishToPager`")
and confirmed `active` is a pager-store field, not a publication field.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R84: 0/5. Both findings were residuals from the
orchestrator's own R82 / R83 rewrites. Process lesson logged: a docstring
rewrite describing a multi-branch derivation must capture the FULL
behavior (verify against the complete code body, every branch), not
simplify -- a simplification that drops a reachable branch is itself a
new defect.
