# RV21-C01 Audit 36 (R36)

**Date:** 2026-07-30. **Round:** R36. **Votes:** auditor A PASS, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor B finding (CONFIRMED after orchestrator cross-check)

Five code comments cited the R24-A / R26-A defect snap magnitudes from
the preliminary audit probes (~240px, ~96-143px) instead of the
formalized preventive tests' own BEFORE measurements (journal L4974:
303.87px; L5134: 237.69px). The two `messages-back-swipe.spec.ts` sites
are the tests' own docstrings, so they directly contradicted what the
test measures. The orchestrator cross-checked the journal BEFORE numbers
and the geometry (R24-A bm ~= 0.23 -> 303px; R26-A bm ~= 0.604 ->
237px); both confirm B.

Sites fixed (R24-A `~240px` -> `~304px`; R26-A `~96-143px` -> `~238px`):

- `src/lib/utils/header-probe.ts:212` (R24-A)
- `src/lib/utils/header-probe.ts:118` (R26-A)
- `src/lib/components/organisms/Header.svelte:544` (R26-A)
- `e2e/messages-back-swipe.spec.ts:3349` (R24-A)
- `e2e/messages-back-swipe.spec.ts:3465` (R26-A)

## Non-blocking (auditor B, borderline; left unchanged)

R23-B F1's `~168px at raw=0.43` (header-probe.ts:197, orchestrator:2975,
e2e:3214) is parametrized at the goto-injection raw (`0.43 * 393 =
168.69`), geometrically defensible, vs the test's snap-frame bm=0.30
(117.98px). B classified borderline/non-blocking. Left this round.

## Verify

`bun run check` 0/0; `bun run lint` exit 0; prettier + em-dash clean on
all three edited files. Comment-only; runtime unchanged (R24-A/R26-A
guards green per R36 auditor B: 20.04px / 23.97px, both < 30px).

## Disposition

Counter after R36: 0/5.
