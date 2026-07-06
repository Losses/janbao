# RV20-C04 - Audit Round 05 (2-auditor model)

Fifth audit round for Cycle 4 (the architect's floor). Two auditors
(A, B) examined the post-R4 state. Result: **split** - auditor A PASS,
auditor B FAIL with two missing-test concerns. Both missing tests added
(fixing B's concerns). The implementation logic was again verified
clean by both. R5 did not converge (B's concerns reset the counter); R6
will confirm the post-fix state.

## Auditor verdicts

- **Auditor A: PASS.** Zero concerns. Re-ran every gate, verified the
  integrator math (including the already-at-target `directionSign === 0`
  case and the load-bearing `<=`), the structural invariant, reduced-
  motion snap, interruption, the SSR + single-flight gate, no DOM
  read-back, shadow mode, all 24 Cycle-5 references qualified, and all
  R1-R4 fixes present. One nitpick (stale "33 tests / eight describe
  blocks" in the Implementation Log).
- **Auditor B: FAIL.** Two missing-test concerns: the `<= 0` branch's
  already-at-target case (`directionSign === 0`) and the reversed-cancel-
  velocity case were documented (R4) but not tested, so the
  "load-bearing `<=`" claim was doc-only and unenforceable.

## Auditor divergence

A judged existing coverage sufficient; B wanted the two explicit cases.
B is binding under the architect's rigor directive: a documented
load-bearing branch edge needs a test that pins it, or a one-character
`<=` -> `<` edit would silently change the at-target settle from
`T_DEFAULT` (300ms) to the solve's `T_MIN` clamp (100ms) with no test
failure. Resolved by adding both tests.

## Concerns (both blocking, both fixed)

1. **Missing test: already-at-target routes to T_DEFAULT** (auditor B).
   `solveCommitDuration` with `currentProgress === target`
   (`directionSign === 0`) hits the `<= 0` branch and returns
   `COMMIT_T_DEFAULT_MS`. Added test: `progress already at target falls
back to COMMIT_T_DEFAULT_MS (enforces the <= choice)` - asserts
   `currentProgress = 1, target = 1` yields 300ms, pinning the `<=`.
2. **Missing test: reversed cancel velocity routes to T_DEFAULT**
   (auditor B). The branch is plan-agnostic but only the commit-direction
   reversal was tested. Added test: `reversed cancel velocity falls back
to COMMIT_T_DEFAULT_MS` - `progressDirection = 1` (cancel, target 0),
   `currentProgress = 0.5`, positive release velocity (away from target 0) yields 300ms.

## Nitpick (non-blocking, journal `.md`, fixed)

- The Implementation Log said "33 tests across eight describe blocks."
  Actual after R3's `shouldScheduleRaf` addition and R5's two tests: 36
  tests across 9 describe blocks. Corrected.

## State after R5 fixes

43/43 unit tests pass across the two new suites (141 expect() calls; +2
`solveCommitDuration` edge tests); `bun run check` 0 errors / 0
warnings; `bun run lint` exit 0; `bun test src/lib` 442/0; shadow mode
preserved; no em-dashes.

Consecutive pass votes: **0** (R5 split; B's two missing-test concerns
reset the counter; the implementation logic has been auditor-verified
clean across R1-R5).
