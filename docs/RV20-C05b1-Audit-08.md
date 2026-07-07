# RV20-C05b1 - Audit Round 08 (2-auditor, with e2e gate)

Result: **0/2 PASS**. Two concerns across both auditors.

## Auditor verdicts

- **A: PASS-WITH-CONCERNS.** Two concerns:
  - **C1:** stale `#publish` docstring (said the commit path passes
    "executor's current progress" but after R5's `#thresholdToRaw` it
    passes the converted raw value).
  - **C2 (sub-morph-threshold commit discontinuity):** for releases
    in the 60-78px range, `#thresholdToRaw(0)` returns 0, causing
    coverProgress to dip. Fixed: `#onExecutorTick` skips publish when
    `progress <= 0` (the last live-drag publish stays).
- **B: PASS-WITH-CONCERNS.** One concern (same as A's C1 docstring).
  Plus the regex comment in `nav-pipeline-gate.ts` (claimed `/pN` only
  but the regex matches any single-segment suffix).

## Fixes

- C1/A+B docstring: updated to describe both paths passing raw on the
  same scale.
- C2: `if (progress <= 0) return;` guard in `#onExecutorTick`.
- Regex comment: corrected to describe the actual match behavior.

## State

check 0, lint 0, 423 unit pass, 72 e2e pass.

Consecutive pass votes: **0**.
