# RV20-C05b1 - Audit Round 26 (architect-run, 2 independent auditors, with e2e gate)

Result: **0/2 PASS**. Auditor A FAIL (2: a leftward re-grab correctness
bug + a comment); auditor B PASS-WITH-CONCERNS (1: a stale `#publish`
docstring). R21-R25 fixes held. R26's serious finding (A-C1) was a bug
introduced by the R25 B-C5 re-grab fix: the `#prevWasDrag` detection
fired `#beginGesture` for LEFTWARD drags too, and `#beginGesture`'s
direction guard cleared `#pendingGesture` and returned WITHOUT stopping
the commit rAF, so a leftward drag mid-commit stranded the track at the
target and dropped the nav. Fixed.

## Architect gate outputs (post-R26-fix, real)

```
$ bun run check          0 errors / 0 warnings (1458 files)
$ bun run lint           EXIT=0 (prettier clean, no em-dashes; 0 type duplicates)
$ bun test src/lib/utils src/lib/stores    435 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview
                    fab reproduce-user-bugs enter-animation backtarget tab-history
  79 passed (2.7m)   (+1: leftward drag during commit does not strand/drop)
```

## Concerns + fixes (all confirmed)

- **A-C1 (leftward re-grab mid-commit strands the track + drops the nav,
  correctness + §5 + behavior)**: the R25 `#prevWasDrag` detection fired
  `#beginGesture` for any drag direction; the direction guard then did
  `#pendingGesture = null; return;` WITHOUT calling `executor.onDragStart`
  (so the commit rAF kept running). On settle, both pending slots were
  null -> `#landAtRest` (no dispatch). The track slid to the target
  (inbox visible) but the URL stayed on the conversation. Fix: the pilot
  claims only RIGHTWARD back-swipes, so `#interpretIntent` now detects a
  gesture start only for `drag-right` (`isRightDrag`/`#prevWasDrag`), and
  the live-drag loop runs only for `drag-right`. A leftward drag is
  ignored entirely -> an in-flight commit continues, settles, and
  dispatches. `#beginGesture`'s direction guard no longer clears
  `#pendingGesture` (defensive return only). New e2e "leftward drag
  during a commit does not strand the track or drop the nav".
- **A-C2 (comment)**: the `#beginGesture` "before mutating any state"
  comment was wrong (it mutated `#pendingGesture`). Reworded (the guard
  is now defensive; leftward is filtered upstream).
- **B-C1 (comment)**: the `#publish` JSDoc referenced `#thresholdToRaw`
  (removed in R23); reworded to describe the actual commit publication
  (lerp from `#commitStartRaw`).

## Convergence picture

R21 -> R26 each found real concerns; each round's fixes held. R26's was
a self-inflicted bug from the R25 re-grab fix (leftward drag now reached
`#beginGesture`), now fixed + e2e. The §5 interruption family is the
recurring theme; each instance is found and closed. Gates green
throughout.

Consecutive pass votes: **0** (R1-R26 each carried concerns).
