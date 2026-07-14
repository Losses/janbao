# RV20-C05b2 - Audit Round 20 (post-R19-fix + centralized interruption)

Result: **A PASS-WITH-CONCERNS (1 CONCERN + 1 NITPICK); B PASS-WITH-CONCERNS
(1 LOW + 1 LOW + 1 INFO).** Counter stays **0/5** (both PWC). R20 confirmed
the §5 invariant is met (zero CSS transitions / setTimeout in the animation
layer, verified by both auditors across every component). The finish-then-new
interruption policy is correct. The state machine authority is correct. The
global singleton lifecycle is correct.

## A findings

- **A F1 (CONCERN):** FAB pinned during mid-family-swap drag (the FAB stays
  stuck at the eased value instead of following the drag). Fixed: replaced the
  pin with #fabDragSeedFraction - the FAB now follows the drag continuously from
  the eased value (coverProgress seeded so the FAB scales from the eased value to
  1 as the slide progresses).
- **A F2 (NITPICK):** spec §5 wording (tab-click morph is post-landing, not
  during-slide). Fixed: spec wording split into gesture vs tab-click.

## B findings

- **B F1 (LOW):** settle re-arm visual jump on rapid title change (re-arm from
  progress 0 causes a ~50% title span jump). Fixed: re-arm from the current
  settleProgress.
- **B F2 (LOW):** #computeFabRestingScale uses a /activity-specific check instead
  of the general formula. Fixed: generalized to match the FAB layer's check.
- **B F3 (INFO):** #lastLandWasPipelineCommit lifecycle comment (the flag
  intentionally survives the settleActive early-return). Fixed: added comment.

## Gate outputs (post-fix)

```
$ bun run check                       0 errors / 0 warnings (1462 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    418 pass / 0 fail
$ bun run test:e2e                    198 passed, EXIT=0
```

R21 audits the post-fix state. The findings are converging (R20: 0 HIGH/MED,
1 CONCERN + LOWs).
