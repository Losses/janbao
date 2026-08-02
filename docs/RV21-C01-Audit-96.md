# RV21-C01 Audit 96 (R96)

**Date:** 2026-08-03. **Round:** R96. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

Three findings, three pre-existing comment inaccuracies (not from the
recent R91-R95 cascade).

## Auditor A (CONFIRMED): OrchestratorPublication "reads only" stale

**F1** `orchestrator:282-283` -- said the Header reads "only the settle /
scrub fields directly off this orchestrator singleton". Wrong: the Header
also reads `dragMorphAnchor`, `dragSearchAnchor`, `searchAnchor` directly
(added in R8-A/R26-A, documented in the Header intro at R82-F1, but this
OrchestratorPublication docstring was never updated). Dropped "only" and
added the drag/search-anchor getters.

## Auditor B (2 findings, CONFIRMED): "startMorph === destMorph" overclaim

**F1** `Header.svelte:284-286` + **F2** `header-probe.ts:60-62` -- both
said "For the no-anchor from-rest case `startMorph === destMorph`, so the
lerp is a constant hold". Wrong for tab-ness-changing commits (e.g. tab
descent: startMorph=0, destMorph=1, the lerp animates). Scoped the claim
to "cancels and same-tab-ness shapes (constant hold); a tab-ness-changing
commit (e.g. tab descent/ascent) animates the morph".

## Orchestrator verification

Independently verified A-F1 (the Header reads dragMorphAnchor at
Header:196/249/269, searchAnchor at :576, dragSearchAnchor at :580,
confirmed in R82-F1). B-F1/B-F2: confirmed startMorph=0, destMorph=1
for a from-rest tab-descent commit (the `header-tab-descent-cross-tab-
exit.spec.ts` test asserts the morph animates). `bun run check` 0/0;
prettier + em-dash clean.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R96: 0/5.
