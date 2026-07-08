# RV20-C05b1 - Audit Round 20 (2-auditor, with e2e gate)

Result: **0/2 PASS**. Both found the same defect: R19-A's
`startProgress` fix in `#beginGesture` was dead code (`onDragMove`
overrode it immediately in the same `#interpretIntent` call).
Fixed.

## Auditor verdicts

- **A: PASS-WITH-CONCERNS.** Empirically confirmed the ~270px leftward
  jump with a rAF sampler diagnostic. R19-B's PASS was incorrect (the
  test's reversal check had a zero-delta blind spot).
- **B: PASS-WITH-CONCERNS.** Same finding: `onDragMove` in
  `#interpretIntent` runs immediately after `#beginGesture` returns,
  overriding `startProgress` with `trackProgress=0` (dead zone).

## Fix

Added a `gestureJustStarted` local flag in `#interpretIntent`: set when
`#beginGesture` is called; the drag-move block skips on that same
event (`!gestureJustStarted`). The first real `onDragMove` (next
pointermove) uses the live finger offset. This preserves `startProgress`
for one frame so the enter-interrupt handoff is visually continuous.

## State

check 0, lint 0, 9/9 gesture e2e pass (reversals:0).

Consecutive pass votes: **0** (R20 carried concerns from both auditors).
