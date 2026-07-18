# RV20-C05b2 - Audit Round 78

Result: **A PASS-WITH-CONCERNS (1 low); B PASS-WITH-CONCERNS (1 medium).**
Counter stays **0/5**. A found 2 em dashes in an e2e spec comment. B found that
the R70 A2 fix (changing playEnterAnimation's outgoing title to
`#prevHeaderTitle`) was a regression: by the time `playEnterAnimation` runs in
`onMount`, the Header's `$effect.pre` has already updated `#prevHeaderTitle` to
the destination's title, making the crossfade invisible. Both fixed.

## A's finding

1. **U+2014 em dashes in e2e spec comment (LOW, FIXED).**
   `e2e/fab-boundary-swipe-sync.spec.ts:18-19` had 2 em dashes. Replaced with
   commas.

## B's finding

1. **playEnterAnimation outgoing title was `#prevHeaderTitle` (the destination's
   title by the time it's read), not the source/back-target's (MEDIUM, FIXED).**
   The R70 A2 fix changed the outgoing from
   `resolveDeepHeaderTitle(inputs.backTarget, t)` to `this.#prevHeaderTitle` for
   "consistency" with `#armSettleEaseFromGesture`. But the two paths have
   different timing: the gesture starts while the user is on the source page
   (`#prevHeaderTitle` IS the source's live title), while `playEnterAnimation`
   runs in `onMount` AFTER the Header's `$effect.pre` has already processed the
   new URL and updated `#prevHeaderTitle` to the destination's title. The settle
   had `outgoing = destination, incoming = destination` (invisible crossfade).
   Fixed: reverted to `resolveDeepHeaderTitle(inputs.backTarget, t) ?? ''` (the
   back-target's static title, always a tab root or tab route, so the resolver
   returns null for it, giving `''`). Updated the comment to explain the timing
   difference from the gesture-release path.

## Gate outputs (post-fix, independently re-run 2026-07-17)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    378 pass / 0 fail
$ bun run test:e2e                    203 passed + 1 flaky (exit 0)
```

R79 audits this state.
