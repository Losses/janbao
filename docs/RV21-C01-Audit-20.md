# RV21-C01 Audit 20 (R20)

**Date:** 2026-07-29. **Round:** R20. **Counter after:** 0/5 (auditor A BLOCK;
auditor B BLOCK).

## R20-A F1 (1 site): "all of which set #enterFabAnchor" overclaim

`orchestrator:3727-3730` overclaims that discrete-nav and accelerate-in-flight
paths unconditionally set `#enterFabAnchor` (they conditionally set it). Drop the
clause (mirror L812-813 / L2958-2960).

## R20-B F1 (19 sites): FAB scale "half-mapping" overclaim after computeFabScale extraction

R9-A F1 replaced the FAB layer's single-formula `fabScale(progress, fromHasFab,
toHasFab)` with a five-branch `computeFabScale(inputs)`. 19 comments across
`src/lib` (nav-resolvers, nav-dom-driver, route-data, route-config, orchestrator,
FloatingActionButtonLayer) and `e2e` (fab.spec, fab-boundary-swipe-sync,
fab-compose-backswipe, fab-deep-page-boundary, reproduce-new-mobile-bugs,
tab-host-swipe, messages-back-swipe, helpers) still describe the FAB scale as
the single half-mapping. Each must be updated to reference `computeFabScale`
(5-branch: boundary, suppressed, enterAnchor lerp, dragAnchor shift, natural).

## Counter after R20: 0/5.
