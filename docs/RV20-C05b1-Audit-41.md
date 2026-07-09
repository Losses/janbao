# RV20-C05b1 - Audit Round 41 (architect-run, 2 independent auditors)

Result: **0/2 PASS**. Both PASS-WITH-CONCERNS (2+2 = 4). Core logic
verified sound. Fixes for A-C2 (stale startProgress during preload
wait), B-C1 (gesture chipExitPhase never reached 'sliding'), A-C1
(TAB_CLICK_COMMIT_MS docstring). B-C2 (updateViewport stale after
one-shot resize during transition) OPEN - edge case requiring
dual-width tracking.

## Fixes landed

- **A-C2 (stale startProgress during preload wait)**: `onSvelteKitBeforeNavigate`
  now calls `executor.stop()` before `preloadData` for chip-exit, halting the
  in-flight commit rAF so the executor's progress freezes at the tab-click
  moment. `beginSlide` (after preload resolves) calls `#startProgressFromCurrentVisual`
  which reads the frozen progress. No staleness. Also prevents a premature
  settle dispatch during the preload wait.
- **B-C1 (gesture chipExitPhase never 'sliding')**: the gesture commit
  release branch now sets `chipExitPhase = 'sliding'` when committing a
  chip-exit gesture (`this.#publication.chipExit`). The chip overlay now
  transitions pending -> sliding during the commit slide.
- **A-C1 (TAB_CLICK_COMMIT_MS docstring)**: now mentions it's used by
  both `onSvelteKitBeforeNavigate` (tab-click) and `playEnterAnimation`.

## Gate outputs (real)

```
$ bun run check          0 errors / 0 warnings (1458 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
```

Consecutive pass votes: **0** (R41 carried concerns; R42 audits post-fix).
