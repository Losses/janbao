# RV20-C05b1 - Audit Round 09 (2-auditor, with e2e gate)

Result: **0/2 PASS**. Both auditors FAIL on the CSS keyframe forward-
enter animation (UNIFY violation: a parallel mechanism that overrides
driver writes during its 200ms active phase). The prior fixes (R1-R8)
all hold; the sole concern is the R8 forward-enter implementation
approach.

## Auditor verdicts

- **A: FAIL.** One concern: the CSS `@keyframes nav-host-enter` animation
  is a second transition mechanism. During the 200ms active phase, CSS
  animations override the driver's `setProperty('transform', ...)`
  (no priority argument = normal author, ranked below active animations).
  A gesture started mid-enter would be invisible. The orchestrator's
  unused `playEnterAnimation()` method is the unified alternative.
  Missing coverage: no e2e exercises a gesture started during the
  200ms enter window.
- **B: FAIL.** Five concerns: C1 (forward-enter e2e fails in isolation:
  `first=0, last=0`); C2 (CSS keyframe violates §13.3 no-CSS-transition
  binding constraint); C3 (gesture-during-enter dead zone: driver writes
  overridden by CSS animation for 200ms); C4 (dead code:
  `playEnterAnimation` exists but never called); C5 (weak e2e: only
  asserts `delta > 50`, doesn't check reversals/duration/endpoints).

## Fix (architect)

Removed the CSS `@keyframes nav-host-enter` + `.enter-slide` class +
`enterAnimating` state entirely. The forward-enter is now driven by
`orchestrator.playEnterAnimation()` (the executor's rAF, the SAME writer
as gestures) + a deferred `requestAnimationFrame` in onMount to seed the
initial `translateX(0px)` and measure viewport width before calling
`playEnterAnimation()`. This is the UNIFY-correct approach: no parallel
mechanism; a gesture starting mid-enter cleanly interrupts the enter
(same writer, same executor).

## State after R9 fix

check 0, lint 0, 423 unit pass, 6/6 gesture e2e pass (incl. forward-
enter: track slides >50px), 38 broader e2e pass.

Consecutive pass votes: **0** (R9 carried the CSS UNIFY violation from
both auditors).
