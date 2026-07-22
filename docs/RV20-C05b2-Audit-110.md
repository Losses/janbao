# DV20 Cycle 5b2 - Audit 110 (R110)

**Date:** 2026-07-22. **Round:** R110, the eighth spec-scoped round. **Counter after:** 0/5 (both auditors BLOCK). **Gate:** green (comment-only fixes).

Both auditors voted BLOCK on 4 combined comment-accuracy concerns, all fixed.

## A findings (3, fixed)

- **A1 (nav-pipeline-gate.ts:18-36, concern).** `isNavPipelineRoute` docstring enumerated 7 categories of matches but omitted `/discussions/p\d+` (which the implementation matches at line 63). The closing sentence "not listed here does not mount a pipeline host" was contradicted by the code. Fixed: added `/discussions/p\d+` to the enumeration.
- **A2 (route-config.ts:98-103, very low).** `FAB_ROUTE_ATTRIBUTES` table summary said "(Family B/C at scale 0)" but the table also has Family A entries. Fixed: "(Family A at scale 0 or 1; Family B/C at scale 0)."
- **A3 (MobileTabBar.svelte:11-16, very low).** "via its publication" conflated `OrchestratorPublication` (which does not carry `fractionalIndex`) with the pager store (which does, via `#republishToPager`). Fixed: "to the pager store."

## B finding (1, fixed)

- **B1 (orchestrator:2600-2601, 2609, low).** The `#cancelAllAnimationEases` docstring entries 1 + 7 attributed "the settle ease is ended by" to `#cancelSettleEaseRaf`, but `#cancelSettleEaseRaf` only calls `cancelAnimationFrame` (does not set `active: false`). The actual settle-END operations are `#endSettleEase` (sets `active: false`) or `setSettleState({ active: false })`. Fixed: removed `#armSettleEase`'s `#cancelSettleEaseRaf` from the "ended by" list (it cancels + re-arms, not ends); changed `unmount`'s attribution from `#cancelSettleEaseRaf` to `setSettleState({ active: false })` teardown.

check + lint green.
