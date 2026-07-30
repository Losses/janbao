# RV21-C01 Audit 45 (R45)

**Date:** 2026-07-30. **Round:** R45. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): nav-executor-logic cap docstring duration

`src/lib/utils/nav-executor-logic.ts:364-374` (the
`SETTLE_PER_TICK_CLAMP_FACTOR` docstring) cited the FAB release-snap
regression as "~300ms commit duration". That 300ms is the unit test's
backward-velocity `COMMIT_T_DEFAULT_MS` fallback, not the e2e's
velocity-matched duration. The e2e (`e2e/fab-release-snap.spec.ts:10/75/
206/280`, four consistent sites) is ~200ms. The cap-analysis safety claim
(`2*cap ≈ 0.193 < 0.2`) held only at 300ms; at the actual 200ms
`2*cap ≈ 0.290`. Rewrote the example to ~200ms (cap ~0.145,
`2*cap ≈ 0.290` on a delayed tick) and corrected the safety rationale:
the e2e leap-guard `< 0.2` holds because `commitEase` delivers an
intermediate value every normal 60fps frame (the clamp bounds only a
delayed first tick), not because `2*cap < 0.2`.

## Auditor B finding (CONFIRMED): velocity-test total-drag arithmetic

`e2e/messages-back-swipe.spec.ts:1355-1356`. The slow "total drag" was
stated as 520ms but the touchEnd timestamp is `stepCount * stepSec =
14 * 40ms = 560ms` (the 520ms used `(stepCount-1) * stepSec`, inconsistent
with the fast variant's 56ms = `14 * 4ms`). Fixed 520ms -> 560ms so both
clauses use the touchEnd formula.

## Verify

`bun run check` 0/0; `bun run lint` exit 0; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R45: 0/5.
