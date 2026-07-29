# RV21-C01 Audit 23 (R23)

**Date:** 2026-07-29. **Round:** R23. **Counter after:** 0/5 (auditor A BLOCK;
auditor B BLOCK). Both found NEW defect classes.

## R23-A F1 (§5): layer-tier `tabsIn` not decoupled from the settle-arm's `incomingHasTabs`

R22 decoupled the MORPH tier (the helper's `incomingHasTabs` reads the drag's
target). But the LAYER tier (the Header's `tabsIn` reading
`settleLatched.incomingHasTabs`) was NOT decoupled. For shape (F,F,T) (deep
source, deep discrete-nav dest, tab drag target) the layer guard flips from
morph-based to frozen at morph=0.366, causing a ~14.66px layer-style snap.

**Fix:** the layer guard's `tabsIn` should read the drag's target's tab-ness
(not the discrete-nav dest's) during the settle, mirroring the morph-tier
decoupling.

## R23-B F1+F2 (§5, NEW class): search axis has no boundary-continuity anchor

The morph axis has `settleMorphFraction` + `startMorph`/`destMorph`. The FAB
axis has `#enterFabAnchor`. The search axis (`searchProgress` / `trackStyle` /
`searchButtonLeft` / `tabProgress`) has NO anchor mechanism. Two snaps:

F1: ~168px snap at the drag-to-discrete-nav handoff (forward-swipe-to-`/search`
interrupted by a non-search goto; `targetIsSearch` flips, `searchProgress`
collapses from `trackMorph` to 0).

F2: ~393px snap at the commit-to-enter landing for EVERY forward-swipe-to-
`/search` commit (the search panel snaps fully out, then the enter slide
re-animates it in).

**Fix:** add a search-axis anchor mirroring the FAB axis's `#enterFabAnchor`.

## Counter after R23: 0/5.
