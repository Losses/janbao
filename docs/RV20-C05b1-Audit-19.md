# RV20-C05b1 - Audit Round 19 (2-auditor, with e2e gate)

Result: **split** - A PASS-WITH-CONCERNS (2 concerns, both fixed),
B PASS (zero concerns, 234 e2e green, audited the post-fix state).

## Auditor A verdict

PASS-WITH-CONCERNS. Two concerns:

1. **Premature state mutation in `#beginGesture`**: `#isEnterAnimation = false`
   - `#liveDragging = true` executed BEFORE the direction guard. A
     leftward drag (not claimed) would clear the enter flag and set
     liveDragging, corrupting the forward-enter's publication (coverProgress
     unpinned, dragging published true). Fix: hoisted the `direction !==
'right'` guard above the mutations; non-claimed drags now return
     immediately without touching any state.
2. **Gesture-during-forward-enter resets progress to 0**: the R14 fix
   (`startProgress = 1 - enterProgress`) was applied to the tab-click
   path but not the gesture path in `#beginGesture`. A back-swipe started
   mid-enter would snap the track from `tx=-W*p` to `tx=-W` (backward
   jump). Fix: captured `wasEnter` before clearing, computed
   `startProgress = 1 - executor.state.progress` when `wasEnter` is true.
   Test 7 strengthened with rAF sampler + `reversals === 0` assertion.

## State

check 0, lint 0, 9/9 gesture e2e pass (reversals:0 across all cases).

## Auditor B verdict

PASS. Zero defects, zero concerns. 234 e2e green across 8 runs (all
pilot-touching + broader). R18 fixes verified in place. UNIFY intact.
All prior fixes R1-R18 hold. R19-A's two concerns were already fixed
before B ran (B audited the post-fix state).

Consecutive pass votes: **0** (R19 split; A's concern reset).
