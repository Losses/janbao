# RV20-C04 - Audit Round 04 (2-auditor model)

Fourth audit round for Cycle 4. Two auditors (A, B) examined the
post-R3 state. Result: **0/2 PASS** (both FAIL). Six unique code-comment
/ test-name concerns (three each, no overlap), all in the docstring-
precision class - no substantive logic or test-coverage issues. All six
fixed. The implementation logic was again verified clean by both
auditors. Per the architect's directive, this cycle runs to at least R5
(R3's missing-test was "lethal"; the cycle has not earned early
closure).

## Auditor verdicts

- **Auditor A: FAIL.** Three concerns: `ExecutorPhase` docstring
  ("strict subset" - false, it is a projection); `ExecutorState`
  docstring (present-tense "consumers read"); `NavExecutor` class
  docstring (present-tense "drives it from the orchestrator's phase
  events"). All present-tense Cycle-5 attribution without a Cycle-4
  qualifier.
- **Auditor B: FAIL.** Three concerns: the `interrupt` docstring
  (present-tense "the orchestrator continues from here"); the
  `solveCommitDuration` wrong-direction comment (under-describes the
  `<= 0` branch - omits the `directionSign === 0` / already-at-target
  case and the load-bearing `<=` vs `<` choice); the test name "visual
  continuity: visual at interrupt == visual at first new-drag frame"
  (overclaims - only `pageTrack.translateX` is asserted, not
  Fab/Header).

## Concerns (all blocking, all fixed)

1. **`ExecutorPhase` docstring** (auditor A). Said "A strict subset of
   the orchestrator's sub-phases" - false; `{idle, live, committing}`
   is a projection (idle/live are executor-only, not in `TransitionSub`).
   Fixed: now says "A projection ... (NOT a subset)" and enumerates the
   mapping (dragging/scrubbing -> live, committing/cancelling ->
   committing, else -> idle).
2. **`ExecutorState` docstring** (auditor A). "the orchestrator and
   consumers read fields off it" - present-tense, no qualifier. Fixed:
   qualified "in the integrated pipeline...; in Cycle 4 shadow mode
   there is no consumer."
3. **`NavExecutor` class docstring** (auditor A). "drives it from the
   orchestrator's phase events" - present-tense, no qualifier. Fixed:
   qualified "in the integrated pipeline...; in Cycle 4 shadow mode the
   boundary methods have no production caller."
4. **`interrupt` docstring** (auditor B). "the next `applyDrag` from
   the orchestrator continues from here" + "the next drag-start event
   re-enters the live phase" - present-tense Cycle-5 attribution.
   Fixed: qualified "in the integrated pipeline (Cycle-5 orchestrator
   wiring)...; in Cycle 4 exercised only by the unit suite."
5. **`solveCommitDuration` wrong-direction comment** (auditor B). The
   R3 fix described only the reversed-velocity (`< 0`) cases; it omitted
   that the branch is `<= 0`, so `directionSign === 0` (progress already
   at target, `deltaProgress === 0`) also routes to `T_DEFAULT` (300ms),
   not the solve's `T_MIN` clamp (100ms). Verified empirically:
   `currentProgress=1, target=1, v=2` -> 300ms. Fixed: the comment now
   names the already-at-target case and states the `<=` is load-bearing.
6. **"visual continuity" test name** (auditor B). Overclaimed: the body
   asserts only `pageTrack.translateX`. Fixed: renamed to "page-track
   continuity at interrupt (no jump in the progress-driven consumer)"
   and the in-body comment now states FAB/Header depend on liveOffset,
   which legitimately changes with the new drag, so they are not part
   of the no-jump assertion.

## Nitpick (non-blocking, journal `.md`)

- The journal's Verification narrative says "399 pre-existing + 40 new
  = 439"; the actuals (pasted correctly above) are 41 new and 440 total.
  Stale arithmetic in the narrative.

## What was verified clean

Both auditors verified the invariants: integrator math (velocity-match
for forward/cancel/fast/clamped; near-zero fallback; high-velocity
clamp; wrong-direction fallback; ease midpoint 0.75; monotonicity;
variable duration); the structural invariant (one rAF write per
property; `shouldScheduleRaf` single-flight; no CSS transitions /
setTimeout / getComputedStyle / .m41); reduced-motion snap;
interruption (progress preserved); the SSR + single-flight gate
(`shouldScheduleRaf`, four-case test); no DOM read-back; shadow mode
(empty `git diff HEAD` against all existing gesture components and
Cycle 1-3 outputs); all R1/R2/R3 fixes present; all pasted journal
numbers (41/139, 440/1933, 1448 files, 55 similar pairs).

## State after R4 fixes

41/41 unit tests pass across the two new suites (139 expect() calls);
`bun run check` 0 errors / 0 warnings; `bun run lint` exit 0;
`bun test src/lib` 440/0/1933; shadow mode preserved; no em-dashes.

Consecutive pass votes: **0** (R4 carried six code-comment / test-name
concerns; the implementation logic has been auditor-verified clean
across R1, R2, R3, R4).
