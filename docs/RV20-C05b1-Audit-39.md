# RV20-C05b1 - Audit Round 39 (architect-run, 2 independent auditors)

Result: **1/2 (A FAIL, B rate-limited)**. Auditor A found 3 concerns;
auditor B hit a 429 rate limit and did not complete.

## Concerns + fixes

- **A-C1 (the R38 rawStart fix was broken, correctness)**: rawStart was
  captured AFTER `#publication = { progress: 0 }` reset, so it was
  always 0. Fix: moved the capture BEFORE the reset (mirrors the tab-
  click path's commitStartRaw pattern). The auditor found this by
  comparing the gesture path's capture ordering to the tab-click path's
  (the "search for similar bugs" instruction working).
- **A-C2 (viewport resize mid-gesture desync, edge case)**: updateViewport
  mutates viewportWidth during an in-flight gesture; rawDragFraction uses
  the new width while the plan's geometry is locked at the old width.
  Edge case (device rotation during a live gesture). OPEN - to be
  addressed (gate updateViewport on no in-flight transition).
- **A-C3 (missing coverage)**: re-grab e2e samples only the track m41,
  not the FAB scale. OPEN.

## Gate outputs (post-fix, real)

```
$ bun run check          0 errors / 0 warnings (1458 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
```

Consecutive pass votes: **0** (R39 A-FAIL; R40 audits post-fix).
