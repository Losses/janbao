# RV20-C05b1 - Audit Round 38 (architect-run, 2 independent auditors)

Result: **0/2 PASS**. Both PASS-WITH-CONCERNS (2+2 = 4). Core logic
verified sound by BOTH auditors (no correctness/architecture/behavior
defects on the primary paths). Remaining: a FAB coverProgress jump on
re-grab + 3 stale comments.

## Fixes landed

- **FAB coverProgress jump on re-grab (A-C1)**: on a re-grab
  mid-commit, the track position was continuous (via startProgress) but
  the RAW drag fraction (coverProgress for the FAB) jumped from the
  commit's lerped raw (~0.85) to the finger's initial raw (~0.025).
  Fix: `PendingGestureTransition` now carries `rawStart` (the
  publication's progress at gesture start). The live-drag publishes
  `raw = clamp(rawStart + rawDrag, 0, 1)` instead of the bare
  `rawDrag`. For from-rest (rawStart=0): same as before. For re-grab
  (rawStart=commitLastRaw): continuous from the commit's value.
- **CommitInput.reducedMotion docstring (A-C2)**: said "reads this from
  the driver" (stale from R29 commitPhysics rewiring). Reworded.
- **EDGE_DEAD_ZONE overclaim (B-C1)**: the comment claimed all three
  edge checks "use this"; but isEdgeReserve uses
  DEFAULT_EDGE_DEAD_ZONE (separately defined). Reworded to be accurate.
- **"Cycle-5 orchestrator" stale ref (B-C2)**: nav-executor-logic.ts
  line 303. Reworded to "the orchestrator".

## Gate outputs (real)

```
$ bun run check          0 errors / 0 warnings (1458 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
```

Consecutive pass votes: **0** (R38 carried concerns; R39 audits post-fix).
