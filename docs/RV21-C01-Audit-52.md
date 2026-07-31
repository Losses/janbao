# RV21-C01 Audit 52 (R52)

**Date:** 2026-07-30. **Round:** R52. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): orchestrator:4072 branch-5 signal

`orchestrator:4072` (notifyHeaderState mid-settle re-arm) said branch 5
"would snap ... to the natural formula at the current `settleProgress`".
Branch 5 reads `publication.progress` (`fab-scale.ts:198` +
`FloatingActionButtonLayer.svelte:166`), not `settleProgress` (title
spans only). Fixed `settleProgress` -> `publication.progress`.

## Auditor B finding (CONFIRMED): 3 R51-introduced overclaims + fragment

R51 universalized "FAB reads `settleMorphFraction` during a settle"
(branch 3 only). Branch 5 (`enterFabAnchor === null`, e.g. from-rest
tab-click) reads `publication.progress` (clamped by sampleFrame).
Rewrote 3 sites to qualify branch 3 (`settleMorphFraction`, unclamped)
vs branch 5 (`publication.progress`, clamped):

- `nav-executor-logic.ts:367` (`SETTLE_PER_TICK_CLAMP_FACTOR` docstring)
- `nav-executor-logic.ts:405` (sampleFrame docstring)
- `nav-executor-logic.test.ts:487` (describe-block comment)

Also fixed the R51-introduced sentence fragment at
`nav-executor-logic.test.ts:535` ("with the clamp capped." -> "with the
clamp the per-tick advance is capped.").

## Verify

`bun run check` 0/0; prettier + em-dash clean. Comment-only; runtime
unchanged.

## Disposition

Counter after R52: 0/5.
