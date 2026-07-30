# RV21-C01 Audit 35 (R35)

**Date:** 2026-07-30. **Round:** R35. **Votes:** auditor A BLOCK,
auditor B PASS. **Counter after:** 0/5.

## Auditor A finding (orchestrator cross-checked; 2 of 3 sites confirmed)

`notifyHeaderState`'s FAB re-seed docstring attributed the idle-arm skip
to `#enterFabAnchor` being null. The actual guard at orchestrator L4135
is `if (capturedFabScale !== null)`; it skips because
`#fabScaleAtSettleInstant` returns null (no transition in flight for the
idle title-change arm). The sibling search re-seed (L4153) and the
cross-function `#accelerateInFlight` re-seed (L3848) both DO gate on a
prev-anchor, so the FAB comment's causal attribution was the outlier.

**Orchestrator cross-check of A's 3-site sibling claim:**

- L4084-4086 (notifyHeaderState inline docstring): **DEFECT, confirmed.**
  Said "`#enterFabAnchor` is null at the capture, so the null-guard
  skips"; the guard checks `capturedFabScale`. Fixed.
- L840-842 (`#enterFabAnchor` field docstring): **DEFECT.** The generic
  "leaves `#enterFabAnchor` null ... so the null-guard skips" causal is
  wrong for the notifyHeaderState site (whose guard checks
  `capturedFabScale`). Fixed.
- L3261-3263: **NOT a defect (auditor over-counted).** It says "the
  capture returns null and the null-guard skips"; "capture" is
  `capturedFabScale`, which IS what the L4135 guard checks. Accurate;
  left unchanged.

## Fix

L4084-4086 rewritten to name the real guard (`#fabScaleAtSettleInstant`
returns null when no transition is in flight, so the
`if (capturedFabScale !== null)` guard skips). L840-842 rewritten to
attribute the skip to the null FAB-value capture rather than
`#enterFabAnchor`.

## Verify

`bun run check` 0/0; `bun run lint` exit 0; prettier + em-dash clean on
the orchestrator. Comment-only; runtime unchanged (R34/R35 continuity
guards green: R26-A 23.97px, R28 24.05px, both < 30px).

## Disposition

Counter after R35: 0/5.
