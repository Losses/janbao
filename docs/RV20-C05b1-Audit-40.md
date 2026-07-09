# RV20-C05b1 - Audit Round 40 (architect-run, 2 independent auditors)

Result: **0/2 PASS**. A FAIL (3), B PASS-WITH-CONCERNS (1). The
"search for similar bugs" prompt instruction working: A found the
5-instance settle/tick docstring pattern; B found the gesture
chipExitPhase gap.

## Fixes landed

- **A-C1 (5 under-describing docstrings)**: NavExecutorSettleFn /
  NavExecutorTickFn / onSettle / onTick / #onExecutorTick all said
  "when a commit rAF reaches its target" / "after each commit rAF
  sample" - but onCommit fires BOTH synchronously (first frame, before
  the rAF) AND from the rAF, and the snap path fires settle with no
  rAF. Reworded all 5 to describe both paths.
- **A-C2 (viewport resize mid-gesture desync)**: updateViewport now
  returns early when a transition is in flight (#pendingGesture !== null
  || #pendingTabExit !== null). The locked plan keeps its gesture-start
  geometry; only the next transition picks up the new width.
- **B-C1 (gesture chip-exit never set chipExitPhase)**: #beginGesture
  now sets #chipExitPhase = 'pending' for chip-exit (matching the
  tab-click path). The gesture chip-exit is rare (the root layout
  seeds /messages/inbox, so the coordinator usually returns
  direct-slide), but the overlay now shows when it does fire.
- **A-C3 (re-grab e2e missing FAB assertion)**: OPEN. The rawStart
  fix (R38/R39) is code-verified correct (auditor A: "correctly placed
  before the publication reset") but the re-grab e2e samples only the
  track m41, not the FAB scale. A coverage gap, not a code defect.

## Gate outputs (real)

```
$ bun run check          0 errors / 0 warnings (1458 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- 8-spec mobile + desktop sweep    80 passed
```

Consecutive pass votes: **0** (R40 carried concerns; R41 audits post-fix).
