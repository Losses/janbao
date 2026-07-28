# RV21-C01 Audit 17 (R17)

**Date:** 2026-07-28. **Round:** R17. **Counter after:** 0/5 (auditor A BLOCK;
auditor B rate-limited, did not complete).

## R17-A F1 (comment accuracy, 3 sites): "non-enter settle" stale comments in the #accelerateInFlight path

Same class as R16 (which fixed the parallel mid-settle absorb path). R16 missed
the `#accelerateInFlight` path's parallel sites. Three comments in
`nav-pipeline-orchestrator.svelte.ts` (L766-768, L2908-2911, L3453-3457) claim
"for a non-enter settle being accelerated the re-seed is skipped because no enter
anchor was set". Stale after R12-B: gesture-release / discrete-nav / mid-settle
absorb settles all set `#enterFabAnchor`, so `#accelerateInFlight`'s re-seed fires
for them (the FAB reads branch 3, not branch 5). Behaviour correct; comments
wrong.

## Counter after R17: 0/5.
