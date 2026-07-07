# RV20-C05b1 - Audit Round 04 (2-auditor, with e2e gate)

Result: **split** - B PASS (full 182-test e2e green), A PASS-WITH-
CONCERNS (1 concern, fixed).

## Auditor verdicts

- **B: PASS.** Zero defects, zero concerns. Full e2e suite (182 tests)
  green. All prior fixes verified (double-slide, capture-loop, FAB-
  freeze, SWIPE_COMMIT, reversed-cancel).
- **A: PASS-WITH-CONCERNS.** One concern:
  - **C1 (rebound-cancel divergence):** `navPipelinePointer.onEnd`
    accepted only `(deltaX)` and DISCARDED `detectSwipe`'s `velocity`
    and `reversed` (rebound-based). The orchestrator computed its own
    `reversed` (offset-sign-crossing-zero) - a different signal. A
    rebound gesture (drag right 200px, rebound to +130, slow release)
    committed on the pilot where GPL cancels (rebound ≥ 25, no fling).

## Fixes

- `navPipelinePointer.onEnd` now accepts the full `EndHandler`
  signature `(deltaX, velocity, reversed)` and forwards all three to
  `orchestrator.onPointerUp(x, y, velocity, reversed)`.
- The orchestrator's `onPointerUp` accepts optional `velocity`/`reversed`
  overrides; applies them after classification so the release gate uses
  detectSwipe's authoritative rebound signal.
- `buildHandlers` test helper's `onEnd` signature updated too.
- Added rebound-cancel e2e case (drag to +200px, rebound to +130, slow
  release → stays on pilot). Verified: 4/4 gesture e2e pass (reversals:0,
  fabScaleDelta:0.999973).

Consecutive pass votes: **0** (R4 split; A's concern reset).
