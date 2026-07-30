# RV21-C01 Audit 28 (R28)

**Date:** 2026-07-30. **Round:** R28. **Counter after:** 0/5 (auditor A BLOCK;
auditor B BLOCK). Both found the SAME defect (converging).

## F1 (§5, probe-verified by both): #searchProgressAtSettleInstant omits drag-search-anchor branch → 162-219px snap at L2803

The morph helper reads #dragMorphAnchor. The FAB helper reads #dragFabAnchor via computeFabScale. The search helper does NOT read #dragSearchAnchor. At L2803 (discrete-nav arm liveDragSearchProgress capture) a re-grab drag with #dragSearchAnchor set is interrupted → the helper returns the gesture value while the Header renders the drag-anchor shift value → snap.

**Fix:** add a drag-search-anchor branch to #searchProgressAtSettleInstant mirroring the Header's branch 3 shift formula. Place between settle-anchor and gesture branches. + preventive guard + comment rewrites.

## Counter after R28: 0/5.
