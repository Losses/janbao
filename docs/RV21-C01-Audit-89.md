# RV21-C01 Audit 89 (R89)

**Date:** 2026-08-02. **Round:** R89. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

Three findings, two reader-narrowing classes.

## Auditor A (CONFIRMED): `backMorph` "(read only during a live drag)" over-narrows

**F1** `orchestrator:1174-1176` (playEnterAnimation) -- the parenthetical
"(which is read only during a live drag)" about `backMorph` is false.
`trackMorph` (Header:478-482) and `searchProgress` (Header:609-612) read
`backMorph` gated on `transitionTarget !== null && backMorph !== null`
with NO `dragging` gate, so they read it during commit/cancel slides too
(the enter IS a commit slide). The sibling comments (`orchestrator:433-436`,
`:894-896`) correctly state backMorph is published/read on commit-ticks.
The main clause ("the morph during the enter is NOT driven by backMorph")
is correct -- the MORPH DERIVATION gates on `dragging`. Scoped the
parenthetical to "(which the morph derivation reads only while `dragging`)".

## Auditor B (2 findings, CONFIRMED): `transitionTarget` scope + consumer narrowing

**F1** `mobile-pager.svelte.ts:74-77` -- said "pipeline detail-page
transition" (scope-narrowed; `transitionTarget` is published in BOTH
`#republishToPager` branches, incl. tab-to-tab) and "Read by the Header
to resolve the back-arrow reveal" (consumer-narrowed; actually read by
`dragTargetHasTabs`/layer guards, `trackMorph`, `targetIsSearch`, and
`searchProgress`). Broadened both.

**F2** `orchestrator:4714-4715` (`#republishToPager` summary) -- same
single-consumer narrowing ("so the Header's morph derivation can resolve
the back-arrow reveal"). Broadened to "for the Header's drag-endpoint,
track-slide, and search-axis derivations".

## Orchestrator verification

Independently verified all three before editing. A-F1: confirmed
`trackMorph`/`searchProgress` read backMorph with no `dragging` gate and
that `:433-436`/`:894-896` document commit-tick publication. B-F1:
confirmed `transitionTarget: publication.toPathname` in both
`#republishToPager` branches (`:4748` centerTab, `:4797` non-centerTab)
and the 4 Header readers. B-F2: same consumer set.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R89: 0/5.
