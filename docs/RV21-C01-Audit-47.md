# RV21-C01 Audit 47 (R47)

**Date:** 2026-07-30. **Round:** R47. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): SETTLE_PER_TICK_CLAMP_FACTOR 1.20 rationale

`src/lib/utils/nav-executor-logic.ts:372-373` said "1.20 would start
clamping slightly-slow 60fps frames (whose delta can reach 0.080)".
Actual `cap(1.20) = 1.20 * 2 * (16.7/300) * 0.695 = 0.0929`, so a
0.080-delta (~17ms) frame is under the cap and not clamped; 1.20 clamps
frames slower than ~20ms (delta ≈ 0.093). Rewrote to "1.20 would clamp
frames slower than ~20ms (delta ≈ 0.093)".

## Auditor B findings (CONFIRMED)

**Finding 1 (3 sites):** "~200-300ms" range comments on deterministic
velocity=0 commits (always 300ms). R46 fixed the point-estimate ~200ms
sites but missed the range-form siblings. Fixed to ~300ms:
`e2e/deep-to-deep-pre-dispatch-interrupt.spec.ts:13` and `:141`,
`e2e/messages-back-swipe.spec.ts:1693`.

**Finding 2:** cap docstring "1.30 gives cap ≈ 0.100 -> scale drop 0.200,
hitting exactly (equality fails)". Actual `cap(1.30) ≈ 0.101`, `2*cap ≈
0.203`, which exceeds 0.2 (not exactly). Rewrote to "0.101 -> scale drop
0.203, exceeding the leap threshold".

## Verify

`bun run check` 0/0; `bun run lint` exit 0; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R47: 0/5.
