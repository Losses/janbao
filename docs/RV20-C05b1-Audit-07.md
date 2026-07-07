# RV20-C05b1 - Audit Round 07 (2-auditor, with e2e gate)

Result: **0/2 PASS**. Four concerns across both auditors (all fixed).

## Auditor verdicts

- **A: PASS-WITH-CONCERNS.** One concern: stale `NavExecutor.onCancel`
  docstring ("reversed past the start" was the old offset-crossing
  signal; after R4-A the gate uses detectSwipe's rebound-based reversed).
  Fixed by the architect.
- **B: FAIL.** Three concerns:
  - **C1:** `gesture-constants.ts` comment claimed GPL consumes the
    shared `SWIPE_COMMIT`; GPL defines its own local copy.
  - **C2 (SSR FOUC):** `NavPipelineHost` track at SSR was
    `translateX(0px)` (viewportWidth=0). Verified resolved: SSR ships
    `translateX(-50%)` (CSS-native, JS-independent).
  - **C3 (FAB coverProgress discontinuity):** live-drag published raw;
    commit published threshold-absorbed (different scale). FAB scale
    reversed at commit start. Fixed: `#thresholdToRaw` converts the
    executor's progress back to raw during commit. `fabReversals` e2e
    assertion added.

## Fixes

- C1: comment corrected (only the orchestrator consumes the shared
  constant).
- C2: SSR transform verified correct (`translateX(-50%)`).
- C3: `#thresholdToRaw` unifies the publication scale; `fabReversals`
  assertion catches discontinuity regressions.
- A's docstring: updated.

## State

check 0, lint 0, 423 unit pass, 73 e2e pass.

Consecutive pass votes: **0**.
