# RV21-C01 Audit 42 (R42)

**Date:** 2026-07-30. **Round:** R42. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): fab-deep docstring stale FAIL claim

`e2e/fab-deep-real-interaction.spec.ts:13` said "All three FAIL on the
current code". The DV21 R8-R14 fixes eliminated the defects; the tests
now pass (A ran one; the journal's R8/R10/R12-B sweeps include this
spec). Reworded to "Each test guards against one of the three reported
defects (asserting the fixes hold)".

## Auditor B finding (CONFIRMED): enter-settle duration 200ms vs 300ms

`e2e/messages-back-swipe.spec.ts:2772` (R12-B F1) plus siblings `:682`
and `:912` claimed the tab-click enter settle runs ~200ms. A tab-click is
a velocity=0 commit, so `solveCommitDuration` returns
`COMMIT_T_DEFAULT_MS = 300` (nav-executor-logic.ts:50); the
orchestrator's own `playEnterAnimation` docstring (L1160) says "over
~300ms (COMMIT_T_DEFAULT_MS)". Fixed `~200ms` -> `~300ms`, and
re-derived the 2772 FAB math for the 300ms duration (progress ~0.31 at
50ms, natural ~0.38, shift baseline `0.62 + natural`). Also fixed a
duplicated "slide slide" at L912.

The other `~200ms` claims in the file (swipeBack-driven commit slides at
`736/831/881/976`) are velocity-dependent (range 100-600ms, ~200ms
reachable) and legitimate.

## Verify

`bun run check` 0/0; `bun run lint` exit 0; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R42: 0/5.
