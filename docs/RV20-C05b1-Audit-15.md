# RV20-C05b1 - Audit Round 15 (2-auditor, with e2e gate)

Result: **0/2 PASS**. Both auditors FAIL on the same defect: R14's
`startProgress = 1 - enterProgress` fix was dead code (line 817 clears
`#isEnterAnimation` before line 840 reads it, so the `if` is always
false, `startProgress` is always 0). Fixed.

## Auditor verdicts

- **A: FAIL.** Found the ordering bug: line 817 clears the flag before
  line 840 reads it. The `startProgress = 1 - enterProgress` branch is
  unreachable. The track still jumps on tab-click-during-enter. Provided
  the exact fix: capture into a local `wasEnterAnimation` before clearing.
  Also noted the same pattern in `#beginGesture` (line 558 clears before
  line 597's `onDragStart`; mitigated by the first `onDragMove` but
  architecturally similar).
- **B: FAIL.** Same finding, same root cause, same fix suggestion.

## Fix

Captured the flag value into a local `const wasEnterAnimation` BEFORE
clearing `#isEnterAnimation`, then used `wasEnterAnimation` in the
conditional. The `startProgress = 1 - enterProgress` branch now runs
correctly when a tab-click interrupts a forward-enter.

## State

check 0, lint 0, 8/8 gesture e2e pass.

Consecutive pass votes: **0** (R15 carried the ordering defect from
both auditors).
