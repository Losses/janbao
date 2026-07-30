# RV21-C01 Audit 38 (R38)

**Date:** 2026-07-30. **Round:** R38. **Votes:** auditor A PASS, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor B findings (CONFIRMED after orchestrator cross-check)

**F1:** `e2e/messages-back-swipe.spec.ts:1540` R1 snap comment
`~26px / ~82deg` cited the audit's manual-swipe probe (bm=0.458) instead
of the formalized test's swipeBack-based snap (bm=0.66 -> 119deg; journal
L2093; four sibling sites all say `~119deg`). Fixed `~82deg` -> `~119deg`.

**F2 (8 sites):** the "regular per-rAF cadence `~12px / ~22deg`" comments
have px/deg ratio 1.83, but rootLayerTy (40px element) / burgerRot
(180deg) geometry is ratio 4.5, and the formalized tests' actual
frame-to-frame deltas follow 4.5 (journal L2314-2328: 2.78px/12.52deg,
4.04/18.18, 1.93/8.70). Fixed to `~3px / ~13deg` (actual R1 baseline,
ratio ~4.3).

Sites: `messages-back-swipe.spec.ts:1539/1642/1710/1815/2230` + `:1745`
(reversed `~22deg / ~12px`); `offline-back-swipe.spec.ts:68`;
`reproduce-dv20-search-swipe.spec.ts:136`.

## Verify

`bun run check` 0/0; `bun run lint` exit 0; prettier + em-dash clean on
all three edited files. Comment-only; runtime unchanged (R38 auditor A
ran the 41-test messages-back-swipe suite green).

## Disposition

Counter after R38: 0/5.
