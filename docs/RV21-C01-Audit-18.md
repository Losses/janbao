# RV21-C01 Audit 18 (R18)

**Date:** 2026-07-29. **Round:** R18. **Counter after:** 0/5 (auditor A BLOCK;
auditor B BLOCK). Both found the SAME 3 sites (converging).

## F1 (comment accuracy, 3 cross-file siblings): "enter settle" under-description in the #accelerateInFlight reach-path docstrings

R17 fixed the orchestrator's 3 sites but missed these 3 cross-file siblings:

1. `header-probe.ts:110` (EnterFabAnchor interface docstring bullet 2): "enter
   settle" → "in-flight settle".
2. `fab-scale.ts:156` (computeFabScale branch 3): "enter settle" → "in-flight
   settle".
3. `orchestrator:3911` (#fabScaleAtSettleInstant docstring bullet 3): "enter
   settle" → "in-flight settle".

Same class as R17. Behaviour correct; comments under-describe the reach.

## Counter after R18: 0/5.
