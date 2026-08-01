# RV21-C01 Audit 64 (R64)

**Date:** 2026-07-31. **Round:** R64. **Votes:** auditor A PASS, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A: PASS

Exhaustive sweep of the full layer found no defect (branch-classification
universal, no-op qualifiers consistent, rAF attribution accurate, §5
invariant, numeric claims verified, zero stale line-number refs).

## Auditor B finding (CONFIRMED): tab-exit-preview:104 stale line ref

`e2e/tab-exit-preview.spec.ts:104` said "Header.svelte ~L172-179" -- the
actual `rootLayerStyle` derivation that slides the MobileTabBar off-screen
in deep mode is at `Header.svelte:402-408` (drift ~230 lines). R32/R34
had classified this site non-blocking (bundled with the L2803 "within 10
lines" sites), but this site never satisfied that condition. R57-B fixed
the six L2803 references but missed this one (its sibling grep only
matched `L####` patterns in the orchestrator + messages-back-swipe).
Rewrote to name-based "via `rootLayerStyle`" (matching the R57-B pattern).
This was the last stale `~L` line reference in the layer.

## Verify

`bun run check` 0/0; prettier + em-dash clean. Comment-only; runtime
unchanged.

## Disposition

Counter after R64: 0/5.
