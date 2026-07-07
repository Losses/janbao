# RV20-C05b1 - Audit Round 03 (2-auditor, with e2e gate)

Result: **0/2 PASS**. Two substantive behavior-preservation gaps (both
fixed).

## Auditor verdicts

- **A: PASS-WITH-CONCERNS.** One concern: stale `#publish` docstring
  (described the host's `$effect` re-publishing, but after R2-B the
  orchestrator publishes inline via `#republishToPager`; the
  `rawDragFraction` is threshold-absorbed in commit, not raw).
- **B: FAIL.** Two concerns:
  - **C1 (SWIPE_COMMIT gate missing):** GPL cancels a back-swipe if
    `deltaX < 60` (`SWIPE_COMMIT`). The pipeline's classifier committed
    at `decideThreshold=10` - no distance gate. A 30px drag navigated
    on the pilot (GPL cancels). Hair-trigger.
  - **C2 (reversed gestures commit):** if reversed past start, GPL
    cancels. The pipeline emitted `cancelled` -> `onCancel` -> delegated
    to `onCommit` using the plan LOCKED at gesture-start
    (`progressDirection=0`=commit). The cancel distinction was lost.

## Fixes

- **C1:** added `SWIPE_COMMIT=60` to `gesture-constants.ts`; unified
  release gate `shouldCommit = dragDistance >= SWIPE_COMMIT && !reversed`
  in the orchestrator's `#interpretIntent`.
- **C2:** `executor.onCancel` overrides `progressDirection` to 1 (snap
  back to FROM) before delegating to `onCommit`.
- **A's docstring:** updated `#publish`.
- **Coverage:** added partial-swipe-cancel (<60px) + reversed-swipe-
  cancel e2e cases in `messages-back-swipe.spec.ts`. Both pass (URL
  unchanged).

Consecutive pass votes: **0**.
