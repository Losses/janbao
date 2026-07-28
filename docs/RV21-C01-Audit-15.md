# RV21-C01 Audit 15 (R15)

**Date:** 2026-07-28. **Round:** R15. **Counter after:** 0/5 (auditor A BLOCK;
auditor B **PASS** - the second PASS vote in the cycle, after R10-B).

## R15-A F1 (comment accuracy, 4 sites): from-rest FAB capture comments misdescribe the mechanism

Four comments in `nav-pipeline-orchestrator.svelte.ts` (lines 784-786,
2556-2558, 2737-2739, 2904-2906) claim the from-rest tab-click FAB capture at
the discrete-nav arm reads "the natural formula" / "the source's at-rest FAB
presence". Probe-verified: the helper `#fabScaleAtSettleInstant` returns `null`
for the from-rest case (the publication is at rest at the capture moment, so the
helper's `if (!pub.inFlight ...) return null` guard short-circuits). The
behaviour is correct (the null capture skips the re-seed via the
`if (capturedFabScale !== null)` guard; the FAB reads branch 5 naturally). Only
the comments describe the wrong mechanism.

**Fix:** rewrite the 4 comments to describe the null-capture mechanism for the
from-rest case (helper returns null, re-seed skipped, FAB reads branch 5).

## R15-B: **PASS** (no defect)

Auditor B exhaustively examined the layer and found no in-scope defect. All
R5-R14 continuity guards pass empirically. The morph/title/FAB tiers are
continuous at every gesture boundary. Every comment accurately describes the
current code. The second PASS vote in the cycle.

## Counter after R15: 0/5 (the BLOCK resets; R15-B's PASS is recorded but the

round has a concern).
