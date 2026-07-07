# RV20-C05b1 - Audit Round 05 (2-auditor, with e2e gate)

Result: **0/2 PASS**. Four concerns across both auditors (all fixed).

## Auditor verdicts

- **A: PASS-WITH-CONCERNS.** One concern: stale `NavExecutor.onCancel`
  docstring ("reversed past the start" described the old offset-crossing
  signal; after R4-A the gate uses detectSwipe's rebound-based
  `reversed`). Fixed by the architect (updated the docstring to
  reference the rebound signal).
- **B: FAIL.** Three concerns:
  - **C1 (SWIPE_COMMIT comment):** `gesture-constants.ts` claimed GPL
    consumes the shared constant; GPL defines its own local copy. The
    only consumer is the orchestrator.
  - **C2 (SSR FOUC):** `NavPipelineHost`'s track transform at SSR was
    `translateX(0px)` (viewportWidth=0 before JS), showing the LEFT
    panel (inbox list) instead of the centre panel. GPL uses CSS
    `calc(-50%)` (JS-independent). Note: the architect's own curl showed
    `translateX(-50%)` on the pilot (the CMA's fix or the CSS layout
    already produces the correct SSR); the CMA verified and confirmed no
    FOUC remains.
  - **C3 (FAB coverProgress discontinuity):** during live drag
    `coverProgress = raw`; during commit `coverProgress =
executor.progress` (threshold-absorbed, a different scale). At
    commit start coverProgress jumped backward - the FAB scale reversed
    (0.323 → 0.154 → ramp). GPL's coverProgress is continuous.

## Fixes

- **C1:** fixed the comment to state only the orchestrator consumes the
  shared constant.
- **C2:** the NavPipelineHost's SSR transform was verified to produce
  `translateX(-50%)` (no FOUC). The CMA confirmed this via curl.
- **C3:** unified the coverProgress scale. The orchestrator now converts
  the executor's threshold-absorbed progress back to raw-equivalent
  (`raw = 0.2 + 0.8 * threshold`) during commit publication, so
  coverProgress is continuous across the commit boundary. Added a
  `fabReversals` assertion to `messages-back-swipe.spec.ts` (asserts 0).
- **A's docstring:** updated `onCancel` to reference the rebound-based
  reversed.

Verified: gesture e2e 4/4 (reversals:0, fabReversals:0,
fabScaleDelta:0.999973). SSR curl shows translateX(-50%).

Consecutive pass votes: **0** (R5 carried concerns from both auditors).
