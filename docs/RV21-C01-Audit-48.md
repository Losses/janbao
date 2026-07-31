# RV21-C01 Audit 48 (R48)

**Date:** 2026-07-30. **Round:** R48. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): settleStart/targetProgress getter docstrings

`orchestrator:918-921` (`settleStartProgress`) and `925-927`
(`settleTargetProgress`) said "Read by the Header ... to compute the morph
interpolation window". The Header reads neither field (grep Header = 0);
they are consumed only by the orchestrator's own settle rAF (L3336-3338 /
3345). The morph interpolation reads `settleMorphFraction`
(Header.svelte:294-298). Rewrote both docstrings to name the settle rAF
as the consumer and note the Header reads `settleMorphFraction` instead.

## Auditor B finding (CONFIRMED): removed "18ms descent floor" reference

`nav-executor-logic.ts:369` cited "the 18ms descent floor", which was the
`DESCENT_MS_FLOOR = 18` wall-clock guard removed in DV20-C05b2 R132
(replaced by `MIN_INTERMEDIATES = 1`). Rewrote to reference the current
`MIN_INTERMEDIATES >= 1` count guard.

## Verify

`bun run check` 0/0; `bun run lint` exit 0; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R48: 0/5.
