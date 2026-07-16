# RV20-C05b2 - Audit Round 59

Result: **A PASS-WITH-CONCERNS (1 CONCERN + 1 nitpick); B PASS-WITH-CONCERNS
(1 CONCERN).** Counter stays **0/5**. R59 found two narrow edge-case logic bugs
and one spec nitpick. B1 is fixed; A2's straightforward fix was reverted (it
breaks the gap-frame prev-value freezing); needs a different approach. Both
auditors verified the architecture and all Known conditions are correct.

## A's findings (1 CONCERN + 1 nitpick)

1. `#prevHeaderTitle` / `#prevHeaderHasTabs` / `#prevHeaderIsSearch` go stale when
   the user routes through a non-pipeline mobile route between two pipeline routes
   (the `!this.#mounted` early-return updates `#headerT` but not the prev
   values; `releaseInputs` does not reset `#headerStateInitialized`). A
   straightforward fix (update prev values in the early-return) was REVERTED: it
   breaks 5 e2e tests because the same early-return fires during the gap frame
   between `releaseInputs` and `configure`, where the prev values MUST stay frozen
   so the next host's settle crossfade reads the correct outgoing title. The
   correct fix needs to distinguish the gap frame (freeze) from a non-pipeline
   detour (track). Narrow; requires a non-forward nav crossing a non-pipeline
   route between two distinct pipeline routes to trigger.
2. nitpick (spec:125): "app exit call the full unmount teardown" is wrong (app
   exit abandons the singleton). Fixed.

## B's finding (1 CONCERN, FIXED)

1. `notifyHeaderState` mid-settle re-arm hardcoded `targetProgress: 1`, flipping a
   cancel settle's target from 0 to 1 on an async live-title resolution (visible
   morph jump + wrong crossfade direction). Fixed: the re-arm now passes
   `this.#settleTargetProgress` (the running settle's target), which already
   existed as a field.

## Gate outputs (post-fix, independently re-run 2026-07-16)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    408 pass / 0 fail
$ bun run test:e2e                    201 passed + 2 flaky (exit 0)
```

R60 audits the post-R59-fix state.
