# RV20-C05b2 - Audit Round 81

Result: **A PASS-WITH-CONCERNS (1 low + 1 very low); B failed (429 rate limit, re-launch pending).** Counter stays **0/5**. A found an e2e docstring inaccuracy + a real (narrow) replaceState intent leak in the finish-then-new queued replay. Both fixed.

## A's findings

1. **e2e spec docstring "2-panel / left panel" stale (LOW, FIXED).**
   `e2e/forward-deep-to-deep-slide.spec.ts:13-15` said "The 2-panel
   NavPipelineHost has no panel to the right of centre, so the slide reveals
   the left panel." The host is 3-panel (LEFT/CENTER/RIGHT); the forward
   deep-to-deep slide reveals the RIGHT panel. Reworded.
2. **`replaceState` intent lost by finish-then-new queued replay (VERY LOW,
   FIXED).** `PendingDiscreteNav` carried only `{ target }`. The queued replay
   used bare `goto(target)` (push), losing the `replaceState: true` intent from
   `Header.onBack`. For a rapid double-back during a commit slide, the history
   was one entry longer than intended. Fixed: `PendingDiscreteNav` now carries
   `replaceState` (captured from the pager store at queue time); the replay
   passes `{ replaceState }` to `goto`.

## B

B failed due to API rate limit (429). Re-launch pending.

## Gate outputs (post-fix, 2026-07-17)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    378 pass / 0 fail
$ bun run test:e2e                    202 passed + 2 flaky (exit 0)
```

R82 audits this state.
