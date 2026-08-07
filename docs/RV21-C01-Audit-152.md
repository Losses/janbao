# RV21-C01 Audit 152 (R152)

**Date:** 2026-08-07. **Round:** R152. **Votes:** auditor A BLOCK (1),
auditor B BLOCK (2). **Counter after: 0/5.**

## Outcome

Three comment-accuracy defects, all in different sub-clauses of the same
loose-vs-strict class. All fixed.

## A's finding -- `e2e/search-enter-exit-asymmetry.spec.ts:56`

Fourth clause "during tab-to-tab transitions" lacked the `non-centerTab`
qualifier. CenterTab tab-to-tab drags publish raw backMorph (not null) --
the centerTab branch always returns `rawDragFraction`. R132 fixed the
parallel first clause ("at rest on a non-centerTab NavPipelineHost route")
but did not propagate the qualifier to the fourth clause.

Fixed: "during non-centerTab tab-to-tab transitions."

## B's findings (2 sites, all fixed)

- **F1 (LOW):** `orchestrator:4723` "(1 for a tab-root target, 0 for a
  deep target)" -- `atRestMorph(hasTabs)` uses loose hasTabs, not strict
  tab root. `/offline` pill-maps but is not a tab root, so its morph
  destination is 1. Fixed: "(1 for a target with tabs, 0 for a deep target)."
- **F2 (LOW):** `Header:237` "(1 for a tab-root destination)" -- same
  class. Fixed: "(1 for a destination with tabs)."

## Verify

`bun run check` 0/0; `bun run lint` exit 0; `bun test src/lib` 552/0;
prettier clean; no U+2014 em-dash. Comment-only changes.

## Disposition

Counter after R152: 0/5.

**No git mutation.** No commits, no branches, no pushes.
