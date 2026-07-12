# RV20-C05b2 - Audit Round 9 (architect-run, 2 independent auditors)

Result: \*\*A PASS-WITH-CONCERNS (1 CONCERN + 1 LOW); B PASS-WITH-CONCERNS (1 MED

- 1 LOW + 1 CONCERN).\*\* Counter stays 0/5.

Both auditors independently flagged the SAME two issues (consensus) and verified
the rest of the core pipeline clean (no CSS transition/setTimeout, FAB atom
clean, state machine authoritative, no bridge, dead files, all routes migrated,
all trajectories clean, Known #1-11 accurate). The convergence is narrowing to
comment precision + a latent-state field from R8's fix.

## Consensus findings (both auditors)

- **Bidirectional re-grab formula comment claims "1:1" but isn't for re-grabs
  (A #1 / B #1).** The formula `startProgress + rawDrag * (1 - startProgress)`
  maps rawDrag onto the `[startProgress, 1]` window; it is 1:1 only from rest
  (`startProgress=0`). For a mid-commit re-grab the rate scales by
  `(1 - startProgress)` so a full drag completes the slide to TO. FIX: rewrote
  the comment to describe the window mapping accurately (1:1 from rest; rate
  scales for a re-grab so the full span completes). The formula is unchanged;
  it is consistent with the non-bidirectional (thread) host's window mapping
  (both map onto `[startProgress, 1]`; the bidirectional just omits the threshold
  dead-zone), and it ensures a re-grab's full drag reaches TO rather than
  stopping short.
- **Cancel reducer flips `macro.plan.progressDirection` but not `activePlan`
  (A #2 / B #2).** A latent inconsistency from R8's §13.5 fix: the wrapper's
  public `activePlan` getter would return the stale (commit) direction during a
  cancel. No live consumer reads `stateMachine.activePlan` (the orchestrator
  reads `sm.macro.plan` via the derived publication + the executor's own
  `activePlan`). FIX: the cancel reducer now flips `activePlan.progressDirection`
  to 1 alongside `macro.plan`, keeping the two fields consistent.

## Carried

- **B #3**: mid-commit re-grab on the tab host has no e2e (Known #7). The
  window-mapping rate (B #1) is its primary visible symptom; the geometry is
  unit-tested.

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    418 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview fab tab-host-swipe tab-swipe-preview-height    94 passed (R8; no behavior change in R9)
```

Consecutive pass votes: **0/5** (A PWC + B PWC; both consensus findings fixed).
R10 audits the post-fix state.
