# RV21-C01 Audit 44 (R44)

**Date:** 2026-07-30. **Round:** R44. **Votes:** auditor A BLOCK, auditor
B BLOCK (same file). **Counter after:** 0/5.

## Finding (both auditors): header-title-replay stale pre-unify docstring

`e2e/header-title-replay.spec.ts` carried pre-DV20-C05B2 Header
architecture references (symbols removed in the `a64af71` unification
refactor). Two sites:

- **L12-31 (auditor B):** the "Root cause" docstring referenced
  `prevTitle`, `displayedTitle`, `transitionProgress`,
  `titleTransitionActive`, `onSwipeEnd`, `dragOffset`, and a title
  `$effect`; none exist in the current source. Rewrote to describe the
  current single `titleView` `$derived` (drag / settle / rest branches)
  with the orchestrator's `settleLatched` endpoints + `settleProgress`
  carrying the crossfade continuously across the drag to settle handoff.
- **L222-224 (auditor A):** the setup comment referenced a "250ms safety
  timeout" (none exists; the deep-to-deep title crossfade is
  `TITLE_CROSSFADE_MS = 200ms`) and `titleTransitionActive === false`
  (no such field; the signal is `settleActive`). Rewrote to
  `TITLE_CROSSFADE_MS = 200ms` and `settleActive === false`.

## Verify

`bun run check` 0/0; `bun run lint` exit 0; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R44: 0/5.
