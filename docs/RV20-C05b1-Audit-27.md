# RV20-C05b1 - Audit Round 27 (architect-run, 2 independent auditors, with e2e gate)

Result: **0/2 PASS**. Auditor A FAIL (2: a leftward-release-during-commit
correctness bug + a sub-threshold-cancel publication discontinuity);
auditor B PASS-WITH-CONCERNS (4 comment-accuracy concerns). R21-R26
fixes held. R27's serious finding (A-C1) was ANOTHER edge of the R25/R26
re-grab work: the release branch had no direction guard, so a leftward
re-grab's RELEASE fired `onCommit` mid-commit (resetting the slide's
speed + re-timing the dispatch). Fixed.

## Architect gate outputs (post-R27-fix, real)

```
$ bun run check          0 errors / 0 warnings (1458 files)
$ bun run lint           EXIT=0 (prettier clean, no em-dashes; 0 type duplicates)
$ bun test src/lib/utils src/lib/stores    435 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview
                    fab reproduce-user-bugs enter-animation backtarget tab-history
  79 passed (2.7m)
```

## Concerns + fixes (all confirmed)

- **A-C1 (leftward release during a commit resets the commit,
  correctness + §5)**: the release branch (`if (#pendingGesture !== null)`)
  had no direction check. After a rightward commit's release,
  `#pendingGesture` stays set; a leftward re-grab + release emitted
  `micro:'committed'` (the classifier does not distinguish direction at
  release) -> `executor.onCommit(negativeVelocity)` reset the in-flight
  commit (new commitStart, 300ms duration), changing the slide speed mid-
  flight and re-timing the settle/dispatch. Fix: the release branch now
  requires `intent.direction === 'right'`; a leftward release is ignored
  (the in-flight commit continues and settles on its own). The R26
  leftward-re-grab e2e (which ends in a leftward release) covers this.
- **A-C2 (sub-threshold cancel publication discontinuity, latent
  correctness)**: a sub-threshold cancel (drag <20%, track at rest,
  release <SWIPE_COMMIT) hit the `span === 0` branch in `#onExecutorTick`
  (progressStart===progressTarget===0), publishing `frac=1` -> raw jumped
  from the live ~0.076 to 0 in one frame (and ran a no-op cancel rAF for
  the cancel duration). Latent (the FAB scale maps both to 0) but the
  publication was discontinuous. Fix: a sub-threshold cancel (executor
  already at rest) now lands at rest immediately (`#landAtRest`) instead
  of starting a no-op cancel rAF - no jump, no wasted rAF.
- **B-C1..C4 (comment drift)**: `#liveDragging` and `#prevWasDrag`
  docstrings overclaimed "drag-left / drag-right" / "drag state" (now
  rightward-only after R26); the live-drag block comment claimed post-
  release streaming it does not do; the NavPipelineHost orchestrator-
  construction comment mis-described the publication path. All reworded.

## Recurring pattern (noted)

R25 re-grab (rightward) -> R26 leftward re-grab strands -> R27 leftward
release resets + sub-threshold cancel. Each interruption fix reveals the
next direction x state edge. The edges are finite (the pilot claims only
rightward; leftward is "ignore", not "interrupt") and each is closed as
found, but the v2 no-borderline bar surfaces them one per round.

Consecutive pass votes: **0** (R1-R27 each carried concerns).
