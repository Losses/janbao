# RV21-C01 Audit 150 (R150)

**Date:** 2026-08-07. **Round:** R150. **Votes:** auditor A BLOCK (1),
auditor B BLOCK (1). **Counter after: 0/5.**

## Outcome

Two comment-accuracy defects in different neighborhoods, both fixed.

## A's finding -- `e2e/reproduce-dv20-drag-sync.spec.ts:97`

Definite-article list "the offline LIST mirror routes `/offline`,
`/offline/activity`" omitted `/offline/bookmarks`, which R142's loose-toIdx
fix made a null-backMorph case. Re-added `/offline/bookmarks`.

**Note:** R153 later proved this re-addition was WRONG -- `updateBackTarget`
overwrites `inputs.toTabIndex` to strict before any gesture, so
`/offline/bookmarks` -> `/offline` actually publishes RAW at runtime.
R153 removed it again.

## B's finding -- `orchestrator:4250`

Trajectory misclassification: `/messages/<id> <-> /search` listed under
"deep<->search" but `/messages/<id>` pill-maps (getCurrentTabIndex=2),
so `resolveHeaderMode` returns 'root' -- it is root<->search. Removed
from the deep<->search parenthetical.

## Verify

`bun run check` 0/0; `bun run lint` exit 0; `bun test src/lib` 552/0;
prettier clean; no U+2014 em-dash. Comment-only changes.

## Disposition

Counter after R150: 0/5.

**No git mutation.** No commits, no branches, no pushes.
