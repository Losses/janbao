# RV21-C01 Audit 49 (R49)

**Date:** 2026-07-30. **Round:** R49. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): settleStart/targetProgress getter "Read by" claim

`orchestrator:919` and `:927` (R48 had rewritten to "Read by the settle
rAF (internal)"). The settle rAF does NOT call the getters; it reads the
private `#settleStartProgress` / `#settleTargetProgress` fields directly.
Both getters have zero public callers (dead code at the public-API level;
A verified by grep across `src/` + `e2e/` + `scripts/`). Rewrote both
docstrings to "No reactive consumer reads this getter; the settle rAF
reads the private `#...` field directly".

## Auditor B finding (CONFIRMED): cap docstring 2\*cap value

`nav-executor-logic.ts:367` "2 * cap ≈ 0.193". At the stated span ~0.7 the
actual is 0.195 (`cap(1.25, 300, 0.7) = 0.0974`, `2*cap = 0.1948`), and
the 0.193 was inconsistent with the same docstring's 1.30 case (0.203,
which requires span 0.7). Fixed 0.193 -> 0.195. The R46 journal entry
carried the same 0.193; synced to 0.195.

## Verify

`bun run check` 0/0; `bun run lint` exit 0; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R49: 0/5.
