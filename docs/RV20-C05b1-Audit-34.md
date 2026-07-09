# RV20-C05b1 - Audit Round 34 (architect-run, 2 independent auditors)

Result: **0/2 PASS**. Both flagged: (a) ~36 stale "Cycle X shadow mode"
docstrings across 9 layer-module files (R33 fixed 2; R34 fixed the other
7 + the chip-exit deviations).

## Fixes landed

- **All 36 stale "shadow mode / Cycle X wires" docstrings reworded** to
  current 5b1 language across: nav-executor.svelte.ts, nav-executor-
  logic.ts (R33), nav-coordinator.ts, nav-resolvers.ts, nav-intent.ts,
  nav-dom-driver-live.ts, nav-state-machine.svelte.ts, nav-state-
  machine-logic.ts, page-lifecycle.svelte.ts (R34).
- **Chip-exit preload: RE-IMPLEMENTED AS AWAIT** (GPL behavior). The
  orchestrator now defers the slide until `preloadData(to)` resolves:
  'pending' phase (chip shows, pulsing @ scale 1.15) -> 'sliding' phase
  (slide plays, chip fades opacity 1->0, scale 1.15->1.6, overlay grows
  maxDrag->W). The R24 B-C3 revert (fire-and-forget) is itself reverted.
  The gesture-during-tab-click e2e that was flaky with the await (R25)
  is already removed (R25), so no flakiness source remains.
- **Chip-exit overlay: ALIGNED WITH GPL**. The overlay is now an anchored
  strip (`absolute inset-y-0 left-0`, width-driven), not a full-viewport
  block. The LoadingChip props (scale, pulsing, opacity) are driven by
  the phase + slide progress, matching GPL's isPendingNavigation /
  isTransitioningOut transitions.

## Gate outputs (real)

```
$ bun run check          0 errors / 0 warnings (1458 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- 8-spec mobile + desktop sweep    80 passed
```

Consecutive pass votes: **0** (R34 carried concerns; R35 audits post-fix).
