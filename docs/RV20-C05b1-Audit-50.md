# RV20-C05b1 - Audit Round 50 (architect-run, 2 independent auditors)

Result: **0/2 PASS**. A PASS-WITH-CONCERNS (3: C1/C2 MED, C3 low-med); B
PASS-WITH-CONCERNS (5 low). Both verified every trajectory correct; no
substantive defect in the non-interrupt paths. The MED was a real FAB
discontinuity bug class (3 sibling sites the R44 fix missed).

## Concerns + fixes

- **FAB coverProgress discontinuity on interrupts (A C1/C2/C3, MED):**
  `rawStart`/`commitStartRaw` captured `publication.progress` without
  checking the coverProgress-forcing conditions (`#isEnterAnimation`,
  `publication.chipExit`). During a forward-enter or chip-exit, coverProgress
  is forced to 0, but `publication.progress` holds the lerped fraction. A
  gesture or tab-click starting mid-enter/chip-exit captured the lerped
  progress (e.g. 0.8) instead of the actual coverProgress (0), so the first
  publication after the interrupt jumped the FAB scale from 0 to ~0.6.
  FIX: the gesture path now captures `coverProgressForcedToZero` before
  clearing `#isEnterAnimation`; the tab-click path checks both
  `#isEnterAnimation || publication.chipExit`. All 3 sibling sites fixed
  (gesture↔enter, gesture↔chip-exit, tab-click↔chip-exit).

## Documented / low

- **dead `coordinate()` call (B C1):** the `to !== backTarget` gate makes
  the gesture's chipExit always false; the coordinator's decision is
  retained for the Layer 4 contract but gated for the pilot. Comment
  accurate.
- **live-drag drop on desktop-flip (B C2):** not a GPL regression (GPL has
  no equivalent recovery path). Low.
- **skeleton branches unreachable (B C3):** spec-mandated fallback; the
  eager-load makes it unreachable today (the real panel always shows).
- **hardcoded chip-exit targets (B C4):** correct for the 3 current tabs;
  a 4th tab would need a branch. Extensibility (5b2).
- **stale `toTag` mount parameter (B C5):** informational only (the state
  machine uses it for diagnostics; no production branch reads it).

## Gate outputs (real, post-fix)

```
$ bun run check          0 errors / 0 warnings (1461 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- 8-spec pilot sweep    81 passed
```

Consecutive pass votes: **0** (R50 A carried the MED FAB bug; fixed; R51
audits the post-fix state).
