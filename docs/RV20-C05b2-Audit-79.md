# RV20-C05b2 - Audit Round 79

Result: **A PASS-WITH-CONCERNS (1 low + 1 low-medium accepted); B
PASS-WITH-CONCERNS (2 CONCERN, comment accuracy).** Counter stays **0/5**.
No logic bugs. All findings are comment accuracy + one accepted design tradeoff.

## A's findings

1. **nav-intent.ts pointerup docstring inaccurate (LOW, FIXED).** Said the
   release "arrives here as a `pointerup` already marked for cancel." The cancel
   signal is applied AFTER `classify` returns (by the orchestrator's
   `onPointerUp` overriding `intent.reversed`), not pre-marked at the classifier
   entry. Reworded.
2. **Within-host pagination nav during a commit rAF is overridden (LOW-MEDIUM,
   ACCEPTED).** A within-host pagination click during the commit rAF window
   (100-600ms) is overridden by the gesture's goto (the committed gesture takes
   priority). By design (the finish-then-new policy excludes within-host navs from
   queueing). Narrow window, unusual sequence, no state leak.

## B's findings

1. **playEnterAnimation back-target claim inaccurate (COMMENT, FIXED).** The
   docstring claimed "The back-target for a forward enter is always a tab root or
   tab route (deep-to-deep is intercepted)." But `detail -> search` forward navs
   (e.g. `/profile -> /search`) are not deep-to-deep, not intercepted, and have a
   deep-page back-target. Reworded.
2. **Discrete-nav settle comment self-contradictory (COMMENT, FIXED).** The first
   block said "the Header settle reads `commitStart.durationMs` and matches it"
   but the next block said "the settle is armed at landing (not in this branch)."
   The settle runs `TITLE_CROSSFADE_MS` post-landing; the slide runs
   `COMMIT_T_DEFAULT_MS`; the two are sequential, not concurrent. Reworded.

## Gate outputs (post-fix, 2026-07-17)

Comment-only fixes; the e2e gate is unchanged from the R78 post-fix run.

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    378 pass / 0 fail
$ bun run test:e2e                    203 passed + 1 flaky (exit 0, R78 post-fix run)
```

R80 audits this state.
