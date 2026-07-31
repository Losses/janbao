# RV21-C01 Audit 53 (R53)

**Date:** 2026-07-31. **Round:** R53. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): 3 release-settle FAB attribution sites

3 comments claimed the FAB reads `publication.progress` (or the per-tick
clamp bounds it) during a release settle. During a gesture-release settle
`#enterFabAnchor` is non-null -> computeFabScale branch 3 reads
`settleMorphFraction` (unclamped). Rewrote to name `settleMorphFraction`:

- `e2e/fab-release-snap.spec.ts:130` (MIN_INTERMEDIATES guard docstring)
- `src/lib/utils/nav-executor-logic.test.ts:634` (per-tick-clamp test
  comment)
- `e2e/messages-back-swipe.spec.ts:264` (FAB-assertion comment)

## Auditor B finding (CONFIRMED): 2 $state backing rationale sites

`#settleStartProgress` docstring claimed "$state-backed so the
publication derived re-runs" -- the publication derived does not read it
(zero reactive readers; the settle rAF reads it non-reactively).
`#settleTargetProgress` docstring "$state-backed for the same reason" --
actually $state-backed because `notifyHeaderState` reads it reactively
(called from the Header's `$effect.pre`). Rewrote both docstrings with
accurate rationale.

## Verify

`bun run check` 0/0; prettier + em-dash clean. Comment-only; runtime
unchanged.

## Disposition

Counter after R53: 0/5.
