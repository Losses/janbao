# RV21-C01 Audit 50 (R50)

**Date:** 2026-07-30. **Round:** R50. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED, fixed): dead publication getters + fields

`settleStartProgress` / `settleTargetProgress` public getters (zero
callers), their backing publication interface fields, and the four
publication-writer assignments were dead code (the settle rAF reads the
private `#settleStartProgress` / `#settleTargetProgress` fields directly).
Removed all three layers (getters + interface fields + writers); the
private fields stay (settle rAF consumer). R49 had documented the
deadness; R50 removed it.

## Auditor B finding (CONFIRMED): cap docstring / test FAB rationale

The `SETTLE_PER_TICK_CLAMP_FACTOR` docstring and two test comments
claimed the per-tick cap bounds the FAB scale's drop in the release-snap
(via `1 - 2*progress` driven by clamped `settleProgress`). During a
gesture-release settle the FAB reads `settleMorphFraction` (the unclamped
`commitEase(u)` eased timeline via `#settleEasedFraction`), NOT
`settleProgress`; the cap bounds `settleProgress` (title spans + page
track), not the FAB. Rewrote the docstring to name `settleProgress` as
the bounded signal and note the FAB reads `settleMorphFraction`
(unclamped); rewrote the two test comments to "pops the title-span /
page-track position" instead of "pops the FAB scale".

## Verify

`bun run check` 0/0; `bun run lint` exit 0; prettier + em-dash clean.
Comment-only + dead-code removal; runtime unchanged.

## Disposition

Counter after R50: 0/5.
