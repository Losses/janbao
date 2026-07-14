# RV20-C05b2 - Audit Round 17 (post-refactor)

Result: **A PASS-WITH-CONCERNS (1 MED + 5 LOW); B PASS-WITH-CONCERNS (1 MED +
2 LOW/CONCERN).** Counter stays **0/5**. R17 audited the state after the
global-manager refactor (steps 1-3) + the full-resolution work (Tasks 1, 2, 3, 5
resolved; Task 4 driver-writes + Task 6 macro divergences honest-unresolved).

## A findings

- **A #1 (MED):** Header `trackStyle`/`searchButtonStyle`/`tabBarStyle` carry
  CSS transitions that fire on non-orchestrator-intercepted navs (deep-to-search).
  Fixed: the tapScrub arming extended to cover any `isSearch` flip; the CSS
  transitions removed.
- **A #2 (MED):** Known #12 "CSS deleted" claim inaccurate (horizontal-track
  CSS remained). Fixed: the CSS was removed (A #1 fix).
- **A #3 (MED):** pager store settle/searchScrubbing fields are dead code.
  Fixed: removed.
- **A #4 (LOW):** TabHost mobile-to-desktop teardown asymmetry. Fixed: added mq
  handler calling full unmount.
- **A #5 (LOW):** "Single rAF" language inaccurate (4 rAFs). Fixed: spec wording
  softened.
- **A #6 (LOW):** settle rAF not cancelled on mid-settle re-grab. Fixed:
  #cancelAllAnimationEases in #beginGesture.

## B findings

- **B #1 (HIGH):** same as A #1 (Header CSS transitions). Fixed.
- **B #2 (MED):** Header settle ease hardcoded 200ms desyncs from
  velocity-matched gesture commit. Fixed: settle uses the executor's commit
  duration.
- **B #3 (MED):** "Single rAF" not realised; steps 3-5 not done. Documented.
- **B #4 (MED):** orchestrator private settle $state violates §13.5. Fixed:
  moved to NavStateMachine.
- **B #5 (LOW):** Known #1 stale. Fixed: doc-cleanup removed.
- **B #6 (LOW):** navInFlight dead clause. Fixed: removed.

## Gate outputs (post-fix)

```
$ bun run check                       0 errors / 0 warnings (1462 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    418 pass / 0 fail
$ bun run test:e2e                    197 passed, EXIT=0
```
